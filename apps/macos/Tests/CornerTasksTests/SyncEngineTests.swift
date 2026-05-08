import XCTest
import CryptoKit
import SQLite3
@testable import CornerTasks

final class FakeTransport: SyncTransport, @unchecked Sendable {
    var challengeResponse: ChallengeResponse = ChallengeResponse(
        challenge: "deadbeefdeadbeefdeadbeefdeadbeef",
        audience: "https://example.test/prod",
        expiresAt: ISO8601.format(Date().addingTimeInterval(300))
    )
    var tokenExpiresIn: TimeInterval = 3600
    private(set) var tokenCalls: Int = 0
    private(set) var challengeCalls: Int = 0
    private(set) var pushBatches: [(accountDid: String, events: [SyncEvent], bearer: String)] = []
    private(set) var pullCalls: [(accountDid: String, since: String, bearer: String)] = []
    var pushResponder: ([SyncEvent]) -> PushResponse = { evs in
        PushResponse(accepted: evs.map(\.eventId), rejected: [])
    }
    var pullResponses: [PullResponse] = []
    var pushFailures: [SyncTransportError] = []
    var pullFailures: [SyncTransportError] = []

    func challenge(accountDid: String) async throws -> ChallengeResponse {
        challengeCalls += 1
        return challengeResponse
    }

    func token(accountDid: String, didJwt: String) async throws -> TokenResponse {
        tokenCalls += 1
        return TokenResponse(
            accessToken: "tok-\(tokenCalls)",
            expiresAt: ISO8601.format(Date().addingTimeInterval(tokenExpiresIn))
        )
    }

    func push(accountDid: String, events: [SyncEvent], bearer: String) async throws -> PushResponse {
        if !pushFailures.isEmpty { throw pushFailures.removeFirst() }
        pushBatches.append((accountDid, events, bearer))
        return pushResponder(events)
    }

    func pull(accountDid: String, since: String, bearer: String) async throws -> PullResponse {
        if !pullFailures.isEmpty { throw pullFailures.removeFirst() }
        pullCalls.append((accountDid, since, bearer))
        if !pullResponses.isEmpty { return pullResponses.removeFirst() }
        return PullResponse(events: [], serverTime: ISO8601.format(Date()))
    }
}

@MainActor
final class SyncEngineTests: XCTestCase {
    private var tmpDir: URL!
    private var store: TaskStore!
    private var transport: FakeTransport!
    private var identity: Identity!
    private var encryptionKey: SymmetricKey!
    private var engine: SyncEngine!
    private let deviceId = "device-fixed-001"

    override func setUpWithError() throws {
        try super.setUpWithError()
        tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("CTSyncTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        store = TaskStore(directory: tmpDir)

        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
        let seed = Mnemonic.toSeed(mnemonic)
        identity = try Identity.fromBip39Seed(seed)
        encryptionKey = DataKey.encryptionKey(from: seed)
        transport = FakeTransport()
        engine = SyncEngine(
            store: store,
            transport: transport,
            identity: identity,
            encryptionKey: encryptionKey,
            deviceId: deviceId,
            lastSyncedAt: InMemoryLastSyncedAt()
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
        try super.tearDownWithError()
    }

    // MARK: - Engine off → silent

    func testEngineDoesNothingWhileCloudSyncDisabled() {
        // Engine is constructed but `installEnqueuer()` was never called → mutations
        // must NOT add rows to sync_queue.
        store.add("local-only")
        store.add("another")
        XCTAssertEqual(store.pendingQueueRows().count, 0)
    }

    // MARK: - Round-trip via fake transport

    func testRoundTripPushesEncryptedEvent() async throws {
        engine.installEnqueuer()
        store.add("ship-it")
        XCTAssertEqual(store.pendingQueueRows().count, 1)

        await engine.flushPushes()

        XCTAssertEqual(transport.pushBatches.count, 1)
        let batch = transport.pushBatches[0]
        XCTAssertEqual(batch.accountDid, identity.accountDid)
        XCTAssertEqual(batch.events.count, 1)
        let event = batch.events[0]
        XCTAssertEqual(event.op, "upsert")
        XCTAssertEqual(event.deviceId, deviceId)
        // Decrypts back to the cleartext we created.
        let pt = try SyncEventCodec.openEvent(event, encryptionKey: encryptionKey)
        XCTAssertEqual(pt?.title, "ship-it")

        XCTAssertEqual(store.pendingQueueRows().count, 0)
    }

    // MARK: - Stale rejection accepted as success

    func testStaleRejectionMarksQueueRowSent() async throws {
        engine.installEnqueuer()
        store.add("stale-event")
        let row = store.pendingQueueRows().first!
        transport.pushResponder = { _ in
            PushResponse(
                accepted: [],
                rejected: [PushResponse.Rejected(eventId: row.eventId, reason: "stale")]
            )
        }
        await engine.flushPushes()
        XCTAssertEqual(store.pendingQueueRows().count, 0)
    }

    // MARK: - Archive cutoff

    func testArchiveCutoffSkipsAncientRowAndMarksSent() async throws {
        engine.installEnqueuer()
        store.add("ancient")
        let item = store.activeTasks.first!
        // Force completedAt to 70 days ago via direct UPDATE.
        let cutoffDate = Date().addingTimeInterval(-70 * 24 * 60 * 60)
        try forceCompletedAt(taskId: item.id.uuidString.lowercased(), date: cutoffDate)
        // Re-enqueue an upsert reflecting the new completedAt.
        store.complete(item)
        try forceCompletedAt(taskId: item.id.uuidString.lowercased(), date: cutoffDate)

        await engine.flushPushes()

        // No pushes — every queued row was cut off.
        XCTAssertTrue(transport.pushBatches.allSatisfy { $0.events.isEmpty })
        XCTAssertEqual(store.pendingQueueRows().count, 0)
    }

    // MARK: - Pull merges (last-writer-wins)

    func testPullMergesLastWriterWins() async throws {
        engine.installEnqueuer()
        store.add("local-version")
        let local = store.activeTasks.first!
        let localUpdated = local.updatedAt

        // Newer remote upsert for the same task.
        let newer = localUpdated.addingTimeInterval(60)
        let event = try SyncEventCodec.makeEvent(
            op: "upsert",
            accountDid: identity.accountDid,
            deviceId: "remote-device",
            taskId: local.id.uuidString,
            updatedAt: newer,
            plaintext: EventPlaintext(
                title: "remote-version",
                createdAt: local.createdAt,
                completedAt: nil,
                dueDate: nil,
                order: local.order
            ),
            encryptionKey: encryptionKey
        )
        transport.pullResponses = [PullResponse(events: [event], serverTime: ISO8601.format(newer))]

        await engine.pullSince()
        XCTAssertEqual(store.activeTasks.first?.title, "remote-version")

        // Now an OLDER remote write — must be ignored.
        let older = localUpdated.addingTimeInterval(-60)
        let stale = try SyncEventCodec.makeEvent(
            op: "upsert",
            accountDid: identity.accountDid,
            deviceId: "remote-device",
            taskId: local.id.uuidString,
            updatedAt: older,
            plaintext: EventPlaintext(
                title: "stale-loser",
                createdAt: local.createdAt,
                completedAt: nil,
                dueDate: nil,
                order: local.order
            ),
            encryptionKey: encryptionKey
        )
        transport.pullResponses = [PullResponse(events: [stale], serverTime: ISO8601.format(Date()))]
        await engine.pullSince()
        XCTAssertEqual(store.activeTasks.first?.title, "remote-version")
    }

    // Regression: events arriving with an uppercase taskId from a v0.2.0-pre
    // peer must merge into the existing lowercase row — not produce a duplicate.
    func testPullEventWithUppercaseTaskIdMergesIntoLowercaseRow() async throws {
        engine.installEnqueuer()
        store.add("first")
        let local = store.activeTasks.first!
        let localUpdated = local.updatedAt

        let newer = localUpdated.addingTimeInterval(60)
        let event = try SyncEventCodec.makeEvent(
            op: "upsert",
            accountDid: identity.accountDid,
            deviceId: "remote-device",
            taskId: local.id.uuidString.uppercased(),
            updatedAt: newer,
            plaintext: EventPlaintext(
                title: "renamed-from-uppercase",
                createdAt: local.createdAt,
                completedAt: nil,
                dueDate: nil,
                order: local.order
            ),
            encryptionKey: encryptionKey
        )
        transport.pullResponses = [PullResponse(events: [event], serverTime: ISO8601.format(newer))]

        await engine.pullSince()

        XCTAssertEqual(store.activeTasks.count, 1, "uppercase taskId must merge, not duplicate")
        XCTAssertEqual(store.activeTasks.first?.title, "renamed-from-uppercase")
    }

    // MARK: - 401 handling: re-auth + single retry, queue rows preserved on persistent failure

    func testPushTokenExpiredTriggersReauthAndRetry() async throws {
        engine.installEnqueuer()
        store.add("retry-me")
        transport.pushFailures = [.tokenExpired]
        await engine.flushPushes()
        XCTAssertEqual(transport.pushBatches.count, 1, "expected one successful retry after re-auth")
        XCTAssertEqual(transport.tokenCalls, 2, "expected initial + post-401 token issuance")
        XCTAssertEqual(store.pendingQueueRows().count, 0)
    }

    func testPersistentAuthFailureKeepsQueueRowsPending() async throws {
        engine.installEnqueuer()
        store.add("auth-fail")
        // First attempt fails 401, retry also fails 401 (token endpoint will succeed,
        // but push keeps rejecting). Queue rows must remain.
        transport.pushFailures = [.tokenExpired, .badToken]
        await engine.flushPushes()
        XCTAssertEqual(store.pendingQueueRows().count, 1)
    }

    // MARK: - Helpers

    private func forceCompletedAt(taskId: String, date: Date) throws {
        // Direct sqlite update bypassing the public API to set up the cutoff state.
        let dbURL = tmpDir.appendingPathComponent("tasks.sqlite3")
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbURL.path, &db), 0)
        defer { sqlite3_close(db) }
        let sql = "UPDATE tasks SET completed_at = ? WHERE id = ?"
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        XCTAssertEqual(sqlite3_prepare_v2(db, sql, -1, &stmt, nil), 0)
        sqlite3_bind_double(stmt, 1, date.timeIntervalSince1970)
        sqlite3_bind_text(stmt, 2, taskId, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        XCTAssertEqual(sqlite3_step(stmt), 101) // SQLITE_DONE
    }
}
