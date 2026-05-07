import CryptoKit
import Foundation

/// End-to-end-encrypted sync engine for the macOS app. Lifecycle:
///
/// - Construct only when `Prefs.cloudSyncEnabled == true` and a valid `backendURL` and
///   `Identity` are available. While disabled, no instance exists — therefore no timers,
///   no enqueuer, and no network calls.
/// - `start()` installs the `TaskStore.eventBuilder` that writes encrypted queue rows on
///   every local mutation, kicks off an immediate `flushPushes()`, and schedules the
///   10-minute push and 1-minute pull timers.
/// - `stop()` cancels both timers and clears the enqueuer. Local state is untouched.
///
/// The 60-day archive cutoff is enforced at flush time: any pending row whose task has
/// `completed_at < now - 60 d` is marked sent without being POSTed.
final class SyncEngine {
    static let pushInterval: TimeInterval = 600   // 10 minutes
    static let pullInterval: TimeInterval = 60    // 1 minute
    static let archiveCutoff: TimeInterval = 60 * 24 * 60 * 60  // 60 days

    private let store: TaskStore
    private let transport: SyncTransport
    private let auth: AuthSession
    private let identity: Identity
    private let encryptionKey: SymmetricKey
    private let deviceId: String
    private let now: () -> Date
    private let lastSyncedAtStorage: LastSyncedAtStorage

    private var pushTimer: Timer?
    private var pullTimer: Timer?

    init(store: TaskStore,
         transport: SyncTransport,
         identity: Identity,
         encryptionKey: SymmetricKey,
         deviceId: String,
         lastSyncedAt: LastSyncedAtStorage = UserDefaultsLastSyncedAt(),
         now: @escaping () -> Date = Date.init) {
        self.store = store
        self.transport = transport
        self.identity = identity
        self.encryptionKey = encryptionKey
        self.deviceId = deviceId
        self.now = now
        self.lastSyncedAtStorage = lastSyncedAt
        self.auth = AuthSession(identity: identity, transport: transport, now: now)
    }

    /// Test hook.
    var authSession: AuthSession { auth }

    func start() {
        installEnqueuer()
        Task { await self.flushPushes() }
        let push = Timer.scheduledTimer(withTimeInterval: Self.pushInterval, repeats: true) { [weak self] _ in
            Task { await self?.flushPushes() }
        }
        let pull = Timer.scheduledTimer(withTimeInterval: Self.pullInterval, repeats: true) { [weak self] _ in
            Task { await self?.pullSince() }
        }
        pushTimer = push
        pullTimer = pull
    }

    func stop() {
        pushTimer?.invalidate(); pushTimer = nil
        pullTimer?.invalidate(); pullTimer = nil
        store.eventBuilder = nil
    }

    /// Sends every pending queue row that is not past the archive cutoff. Marks rows
    /// accepted or stale-rejected as sent. Auth failures cause one re-auth + retry per
    /// flush; persistent auth failure leaves rows in the queue for the next tick.
    func flushPushes() async {
        let rows = store.pendingQueueRows()
        guard !rows.isEmpty else { return }

        var toSend: [SyncEvent] = []
        var skippedSent: [String] = []
        let cutoff = now().addingTimeInterval(-Self.archiveCutoff)

        for row in rows {
            if row.op == "upsert",
               let completedAt = store.taskCompletedAt(taskId: row.taskId),
               completedAt < cutoff {
                skippedSent.append(row.eventId)
                continue
            }
            guard let event = try? JSONDecoder().decode(SyncEvent.self, from: row.payloadJSON) else {
                continue
            }
            toSend.append(event)
        }

        if !skippedSent.isEmpty {
            store.markQueueRowsSent(eventIds: skippedSent, at: now())
        }
        guard !toSend.isEmpty else { return }

        do {
            let response = try await pushWithAuth(events: toSend)
            let toMark = response.accepted + response.rejected.map(\.eventId)
            if !toMark.isEmpty {
                store.markQueueRowsSent(eventIds: toMark, at: now())
            }
        } catch {
            // Leave rows pending; retry next tick.
        }
    }

    /// Fetches events with `updatedAt >= lastSyncedAt`, applies them last-writer-wins,
    /// then advances `lastSyncedAt` to the server's clock from the response.
    func pullSince() async {
        let since = lastSyncedAtStorage.value ?? defaultSince()
        do {
            let response = try await pullWithAuth(since: since)
            for event in response.events {
                applyRemote(event)
            }
            lastSyncedAtStorage.value = response.serverTime
        } catch {
            // Network or auth failure — try again next tick.
        }
    }

    // MARK: - Bearer-aware push/pull

    private func pushWithAuth(events: [SyncEvent]) async throws -> PushResponse {
        let token = try await auth.bearer()
        do {
            return try await transport.push(accountDid: identity.accountDid, events: events, bearer: token)
        } catch SyncTransportError.tokenExpired, SyncTransportError.badToken {
            await auth.invalidate()
            let fresh = try await auth.bearer()
            return try await transport.push(accountDid: identity.accountDid, events: events, bearer: fresh)
        }
    }

    private func pullWithAuth(since: String) async throws -> PullResponse {
        let token = try await auth.bearer()
        do {
            return try await transport.pull(accountDid: identity.accountDid, since: since, bearer: token)
        } catch SyncTransportError.tokenExpired, SyncTransportError.badToken {
            await auth.invalidate()
            let fresh = try await auth.bearer()
            return try await transport.pull(accountDid: identity.accountDid, since: since, bearer: fresh)
        }
    }

    // MARK: - Enqueue (local mutations → encrypted queue rows)

    /// Internal so tests can install the enqueuer without scheduling real timers.
    func installEnqueuer() {
        let key = encryptionKey
        let did = identity.accountDid
        let device = deviceId
        store.eventBuilder = { snapshot in
            let eventId = UUID().uuidString.lowercased()
            let plaintext: EventPlaintext?
            if snapshot.op == "delete" {
                plaintext = nil
            } else {
                plaintext = EventPlaintext(
                    title: snapshot.title,
                    createdAt: snapshot.createdAt,
                    completedAt: snapshot.completedAt,
                    dueDate: snapshot.dueDate,
                    order: snapshot.order
                )
            }
            do {
                let event = try SyncEventCodec.makeEvent(
                    op: snapshot.op,
                    accountDid: did,
                    deviceId: device,
                    eventId: eventId,
                    taskId: snapshot.taskId.uuidString,
                    updatedAt: snapshot.updatedAt,
                    plaintext: plaintext,
                    encryptionKey: key
                )
                let json = try JSONEncoder().encode(event)
                return BuiltSyncEvent(eventId: eventId, payloadJSON: json)
            } catch {
                return nil
            }
        }
    }

    // MARK: - Apply pulled events

    private func applyRemote(_ event: SyncEvent) {
        guard event.accountDid == identity.accountDid else { return }
        guard let taskId = UUID(uuidString: event.taskId) else { return }
        guard let updatedAt = ISO8601.parse(event.updatedAt) else { return }

        // Defense in depth: events for archived tasks older than 60 days are ignored.
        let cutoff = now().addingTimeInterval(-Self.archiveCutoff)
        if updatedAt < cutoff && event.op == "upsert" { return }

        do {
            let plaintext = try SyncEventCodec.openEvent(event, encryptionKey: encryptionKey)
            switch event.op {
            case "upsert":
                guard let pt = plaintext else { return }
                store.applyRemoteUpsert(
                    taskId: taskId,
                    title: pt.title,
                    createdAt: pt.createdAt,
                    completedAt: pt.completedAt,
                    dueDate: pt.dueDate,
                    order: pt.order,
                    updatedAt: updatedAt,
                    eventId: event.eventId
                )
            case "delete":
                store.applyRemoteDelete(taskId: taskId, updatedAt: updatedAt, eventId: event.eventId)
            default:
                return
            }
        } catch {
            return
        }
    }

    private func defaultSince() -> String {
        ISO8601.format(Date(timeIntervalSince1970: 0))
    }
}

// MARK: - lastSyncedAt persistence

protocol LastSyncedAtStorage: AnyObject {
    var value: String? { get set }
}

final class UserDefaultsLastSyncedAt: LastSyncedAtStorage {
    private let key = "cornertasks.sync.lastSyncedAt"
    var value: String? {
        get { UserDefaults.standard.string(forKey: key) }
        set {
            if let v = newValue { UserDefaults.standard.set(v, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }
}

final class InMemoryLastSyncedAt: LastSyncedAtStorage {
    var value: String?
    init(_ initial: String? = nil) { self.value = initial }
}
