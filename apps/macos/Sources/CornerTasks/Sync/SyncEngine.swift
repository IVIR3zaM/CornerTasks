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
    static let archiveCutoff: TimeInterval = 60 * 24 * 60 * 60  // 60 days

    private let store: TaskStore
    private let transport: SyncTransport
    private let auth: AuthSession
    private let identity: Identity
    private let encryptionKey: SymmetricKey
    private let deviceId: String
    private let now: () -> Date
    private let lastSyncedAtStorage: LastSyncedAtStorage
    /// Reads the user-configured sync cadence, in seconds. Defaults to `Prefs.syncIntervalSeconds`.
    private let intervalSeconds: () -> TimeInterval
    /// Set + cleared by the engine. Persisted in `Prefs.pendingFullResync` for callers
    /// that want to trigger a resync on the next start (typically after the user
    /// (re-)enables cloud sync).
    private let pendingFullResync: () -> Bool
    private let clearPendingFullResync: () -> Void

    private var pushTimer: Timer?
    private var pullTimer: Timer?

    init(store: TaskStore,
         transport: SyncTransport,
         identity: Identity,
         encryptionKey: SymmetricKey,
         deviceId: String,
         lastSyncedAt: LastSyncedAtStorage = UserDefaultsLastSyncedAt(),
         intervalSeconds: @escaping () -> TimeInterval = { TimeInterval(Prefs.syncIntervalSeconds) },
         pendingFullResync: @escaping () -> Bool = { Prefs.pendingFullResync },
         clearPendingFullResync: @escaping () -> Void = { Prefs.pendingFullResync = false },
         now: @escaping () -> Date = Date.init) {
        self.store = store
        self.transport = transport
        self.identity = identity
        self.encryptionKey = encryptionKey
        self.deviceId = deviceId
        self.now = now
        self.lastSyncedAtStorage = lastSyncedAt
        self.intervalSeconds = intervalSeconds
        self.pendingFullResync = pendingFullResync
        self.clearPendingFullResync = clearPendingFullResync
        self.auth = AuthSession(identity: identity, transport: transport, now: now)
    }

    /// Test hook.
    var authSession: AuthSession { auth }

    func start() {
        installEnqueuer()
        let interval = max(TimeInterval(Prefs.syncIntervalMinSeconds), intervalSeconds())
        let needsResync = pendingFullResync()
        Task {
            if needsResync {
                await self.performFullResync()
                self.clearPendingFullResync()
            } else {
                await self.flushPushes()
            }
        }
        let push = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { await self?.flushPushes() }
        }
        let pull = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
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

    /// One-shot reset. Discards every row in the local outbound queue, pulls the
    /// full state from the backend (since-epoch), then re-enqueues an upsert for
    /// every local task the server did not return — and pushes the lot. After this
    /// runs, the cloud holds an up-to-date copy of every live local task. Archived
    /// tasks completed more than `archiveCutoff` seconds ago are intentionally
    /// left out; they are dropped from both ends by the retention policy.
    func performFullResync() async {
        store.clearSyncQueue()
        lastSyncedAtStorage.value = ISO8601.format(Date(timeIntervalSince1970: 0))
        let pulled = await pullForResync()
        let cutoff = now().addingTimeInterval(-Self.archiveCutoff)
        for snapshot in store.liveSnapshots() {
            if pulled.contains(snapshot.taskId.uuidString) { continue }
            if let completed = snapshot.completedAt, completed < cutoff { continue }
            store.enqueueSnapshot(snapshot)
        }
        await flushPushes()
    }

    private func pullForResync() async -> Set<String> {
        let since = lastSyncedAtStorage.value ?? defaultSince()
        do {
            let response = try await pullWithAuth(since: since)
            var pulled: Set<String> = []
            for event in response.events {
                applyRemote(event)
                pulled.insert(event.taskId)
            }
            lastSyncedAtStorage.value = response.serverTime
            return pulled
        } catch {
            return []
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
