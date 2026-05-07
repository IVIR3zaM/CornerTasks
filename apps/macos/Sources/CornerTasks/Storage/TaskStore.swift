import AppKit
import Foundation
import SQLite3

let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// State snapshot passed to `TaskStore.eventBuilder` after a local mutation. The sync
/// engine uses it to construct the encrypted `SyncEvent` queued for the backend.
struct TaskMutationSnapshot {
    let taskId: UUID
    let op: String                  // "upsert" | "delete"
    let title: String
    let createdAt: Date
    let completedAt: Date?
    let dueDate: Date?
    let order: Int
    let updatedAt: Date
    let deletedAt: Date?
}

/// Output of the sync engine's event builder: a fully-encoded `SyncEvent` ready to
/// store as a `sync_queue` row.
struct BuiltSyncEvent {
    let eventId: String
    let payloadJSON: Data
}

/// One pending row from the local outbound queue.
struct PendingQueueRow {
    let eventId: String
    let taskId: String
    let op: String
    let payloadJSON: Data
    let createdAt: Date
}

final class TaskStore: ObservableObject {
    @Published private(set) var tasks: [TaskItem] = []
    @Published var showInDock: Bool = Prefs.showInDock {
        didSet {
            Prefs.showInDock = showInDock
            (NSApp.delegate as? AppDelegate)?.applyActivationPolicy()
        }
    }

    private var db: OpaquePointer?

    /// Set by `SyncEngine` while cloud sync is enabled. Receives a snapshot after every
    /// local mutation and returns the encrypted `SyncEvent` JSON to enqueue. Nil while
    /// cloud sync is disabled — mutations then skip queue insertion entirely.
    var eventBuilder: ((TaskMutationSnapshot) -> BuiltSyncEvent?)?

    /// Default-init for the app: stores at `~/Library/Application Support/CornerTasks/`.
    convenience init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = appSupport.appendingPathComponent("CornerTasks", isDirectory: true)
        self.init(directory: folder)
    }

    /// Test-friendly init: stores `tasks.sqlite3` directly under `directory`.
    init(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let dbURL = directory.appendingPathComponent("tasks.sqlite3")

        if sqlite3_open(dbURL.path, &db) != SQLITE_OK {
            assertionFailure("Failed to open sqlite db at \(dbURL.path)")
        }
        Schema.create(db: db)
        migrateFromJSONIfNeeded(folder: directory)
        reload()
    }

    deinit { sqlite3_close(db) }

    var activeTasks: [TaskItem] {
        tasks.filter { !$0.isDone }.sorted { $0.order < $1.order }
    }

    var archivedTasks: [TaskItem] {
        tasks.filter { $0.isDone }
            .sorted { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) }
    }

    func add(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let nextOrder = (activeTasks.map(\.order).max() ?? -1) + 1
        let item = TaskItem(title: trimmed, order: nextOrder)
        let now = Date()
        exec("INSERT INTO tasks (id, title, created_at, completed_at, due_date, ord, updated_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL)") { stmt in
            sqlite3_bind_text(stmt, 1, item.id.uuidString, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, item.title, -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(stmt, 3, item.createdAt.timeIntervalSince1970)
            sqlite3_bind_int64(stmt, 4, Int64(item.order))
            sqlite3_bind_double(stmt, 5, now.timeIntervalSince1970)
        }
        enqueueUpsert(taskId: item.id)
        reload()
    }

    func setDueDate(_ item: TaskItem, due: Date?) {
        let now = Date()
        exec("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?") { stmt in
            if let d = due {
                sqlite3_bind_double(stmt, 1, d.timeIntervalSince1970)
            } else {
                sqlite3_bind_null(stmt, 1)
            }
            sqlite3_bind_double(stmt, 2, now.timeIntervalSince1970)
            sqlite3_bind_text(stmt, 3, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        enqueueUpsert(taskId: item.id)
        reload()
    }

    func complete(_ item: TaskItem) {
        let now = Date()
        exec("UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?") { stmt in
            sqlite3_bind_double(stmt, 1, now.timeIntervalSince1970)
            sqlite3_bind_double(stmt, 2, now.timeIntervalSince1970)
            sqlite3_bind_text(stmt, 3, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        enqueueUpsert(taskId: item.id)
        reload()
    }

    func updateTitle(_ item: TaskItem, title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let now = Date()
        exec("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?") { stmt in
            sqlite3_bind_text(stmt, 1, trimmed, -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(stmt, 2, now.timeIntervalSince1970)
            sqlite3_bind_text(stmt, 3, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        enqueueUpsert(taskId: item.id)
        reload()
    }

    func deleteArchived(_ item: TaskItem) {
        // Soft-delete: keep the row as a tombstone so the sync engine can replicate
        // the delete to other devices. Filtered out of `tasks` by `reload()`.
        let now = Date()
        exec("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?") { stmt in
            sqlite3_bind_double(stmt, 1, now.timeIntervalSince1970)
            sqlite3_bind_double(stmt, 2, now.timeIntervalSince1970)
            sqlite3_bind_text(stmt, 3, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        enqueueDelete(taskId: item.id)
        reload()
    }

    func moveActive(from source: IndexSet, to destination: Int) {
        var active = activeTasks
        active.move(fromOffsets: source, toOffset: destination)
        let now = Date()
        sqlite3_exec(db, "BEGIN", nil, nil, nil)
        for (idx, item) in active.enumerated() {
            exec("UPDATE tasks SET ord = ?, updated_at = ? WHERE id = ?") { stmt in
                sqlite3_bind_int64(stmt, 1, Int64(idx))
                sqlite3_bind_double(stmt, 2, now.timeIntervalSince1970)
                sqlite3_bind_text(stmt, 3, item.id.uuidString, -1, SQLITE_TRANSIENT)
            }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)
        for item in active {
            enqueueUpsert(taskId: item.id)
        }
        reload()
    }

    // MARK: - Sync queue support

    func pendingQueueRows() -> [PendingQueueRow] {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = "SELECT event_id, task_id, op, payload, created_at FROM sync_queue WHERE sent_at IS NULL ORDER BY created_at ASC"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }

        var rows: [PendingQueueRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard
                let eC = sqlite3_column_text(stmt, 0),
                let tC = sqlite3_column_text(stmt, 1),
                let oC = sqlite3_column_text(stmt, 2)
            else { continue }
            let payload: Data
            if let blob = sqlite3_column_blob(stmt, 3) {
                let n = Int(sqlite3_column_bytes(stmt, 3))
                payload = Data(bytes: blob, count: n)
            } else {
                payload = Data()
            }
            let created = sqlite3_column_double(stmt, 4)
            rows.append(PendingQueueRow(
                eventId: String(cString: eC),
                taskId: String(cString: tC),
                op: String(cString: oC),
                payloadJSON: payload,
                createdAt: Date(timeIntervalSince1970: created)
            ))
        }
        return rows
    }

    func markQueueRowsSent(eventIds: [String], at date: Date = Date()) {
        guard !eventIds.isEmpty else { return }
        sqlite3_exec(db, "BEGIN", nil, nil, nil)
        for id in eventIds {
            exec("UPDATE sync_queue SET sent_at = ? WHERE event_id = ?") { stmt in
                sqlite3_bind_double(stmt, 1, date.timeIntervalSince1970)
                sqlite3_bind_text(stmt, 2, id, -1, SQLITE_TRANSIENT)
            }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)
    }

    /// Returns the current `completed_at` of the task identified by `taskId`, or nil if
    /// the task is missing or not completed. Used by the sync engine for the 60-day
    /// archive cutoff at push time.
    func taskCompletedAt(taskId: String) -> Date? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT completed_at FROM tasks WHERE id = ?", -1, &stmt, nil) == SQLITE_OK else { return nil }
        sqlite3_bind_text(stmt, 1, taskId, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        if sqlite3_column_type(stmt, 0) == SQLITE_NULL { return nil }
        return Date(timeIntervalSince1970: sqlite3_column_double(stmt, 0))
    }

    // MARK: - Remote application

    /// Apply a remote `upsert` event with last-writer-wins semantics. Local state is
    /// replaced only when the incoming `updatedAt` is strictly newer than the row's
    /// stored `updated_at` (or equal with a lexicographically greater `eventId`).
    /// Pulled events do not feed back into the outbound queue.
    func applyRemoteUpsert(taskId: UUID, title: String, createdAt: Date, completedAt: Date?, dueDate: Date?, order: Int, updatedAt: Date, eventId: String) {
        let existing = fetchRow(taskId: taskId.uuidString)
        if let existing,
           !shouldReplace(localUpdated: existing.updatedAt, localEventId: existing.lastEventId, incomingUpdated: updatedAt, incomingEventId: eventId) {
            return
        }
        if existing == nil {
            exec("INSERT INTO tasks (id, title, created_at, completed_at, due_date, ord, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)") { stmt in
                sqlite3_bind_text(stmt, 1, taskId.uuidString, -1, SQLITE_TRANSIENT)
                sqlite3_bind_text(stmt, 2, title, -1, SQLITE_TRANSIENT)
                sqlite3_bind_double(stmt, 3, createdAt.timeIntervalSince1970)
                if let c = completedAt { sqlite3_bind_double(stmt, 4, c.timeIntervalSince1970) } else { sqlite3_bind_null(stmt, 4) }
                if let d = dueDate { sqlite3_bind_double(stmt, 5, d.timeIntervalSince1970) } else { sqlite3_bind_null(stmt, 5) }
                sqlite3_bind_int64(stmt, 6, Int64(order))
                sqlite3_bind_double(stmt, 7, updatedAt.timeIntervalSince1970)
            }
        } else {
            exec("UPDATE tasks SET title = ?, created_at = ?, completed_at = ?, due_date = ?, ord = ?, updated_at = ?, deleted_at = NULL WHERE id = ?") { stmt in
                sqlite3_bind_text(stmt, 1, title, -1, SQLITE_TRANSIENT)
                sqlite3_bind_double(stmt, 2, createdAt.timeIntervalSince1970)
                if let c = completedAt { sqlite3_bind_double(stmt, 3, c.timeIntervalSince1970) } else { sqlite3_bind_null(stmt, 3) }
                if let d = dueDate { sqlite3_bind_double(stmt, 4, d.timeIntervalSince1970) } else { sqlite3_bind_null(stmt, 4) }
                sqlite3_bind_int64(stmt, 5, Int64(order))
                sqlite3_bind_double(stmt, 6, updatedAt.timeIntervalSince1970)
                sqlite3_bind_text(stmt, 7, taskId.uuidString, -1, SQLITE_TRANSIENT)
            }
        }
        rememberLastEventId(taskId: taskId.uuidString, eventId: eventId)
        reload()
    }

    func applyRemoteDelete(taskId: UUID, updatedAt: Date, eventId: String) {
        let existing = fetchRow(taskId: taskId.uuidString)
        if let existing,
           !shouldReplace(localUpdated: existing.updatedAt, localEventId: existing.lastEventId, incomingUpdated: updatedAt, incomingEventId: eventId) {
            return
        }
        if existing == nil {
            // Insert a tombstone so subsequent re-creates can be ordered correctly.
            exec("INSERT INTO tasks (id, title, created_at, completed_at, due_date, ord, updated_at, deleted_at) VALUES (?, '', ?, NULL, NULL, 0, ?, ?)") { stmt in
                sqlite3_bind_text(stmt, 1, taskId.uuidString, -1, SQLITE_TRANSIENT)
                sqlite3_bind_double(stmt, 2, updatedAt.timeIntervalSince1970)
                sqlite3_bind_double(stmt, 3, updatedAt.timeIntervalSince1970)
                sqlite3_bind_double(stmt, 4, updatedAt.timeIntervalSince1970)
            }
        } else {
            exec("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?") { stmt in
                sqlite3_bind_double(stmt, 1, updatedAt.timeIntervalSince1970)
                sqlite3_bind_double(stmt, 2, updatedAt.timeIntervalSince1970)
                sqlite3_bind_text(stmt, 3, taskId.uuidString, -1, SQLITE_TRANSIENT)
            }
        }
        rememberLastEventId(taskId: taskId.uuidString, eventId: eventId)
        reload()
    }

    private struct StoredRow {
        let updatedAt: Date
        let lastEventId: String?
    }

    private func fetchRow(taskId: String) -> StoredRow? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT updated_at FROM tasks WHERE id = ?", -1, &stmt, nil) == SQLITE_OK else { return nil }
        sqlite3_bind_text(stmt, 1, taskId, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        let u = sqlite3_column_double(stmt, 0)
        return StoredRow(updatedAt: Date(timeIntervalSince1970: u), lastEventId: lastEventId[taskId])
    }

    private var lastEventId: [String: String] = [:]
    private func rememberLastEventId(taskId: String, eventId: String) {
        lastEventId[taskId] = eventId
    }

    private func shouldReplace(localUpdated: Date, localEventId: String?, incomingUpdated: Date, incomingEventId: String) -> Bool {
        if incomingUpdated > localUpdated { return true }
        if incomingUpdated < localUpdated { return false }
        // Equal updatedAt — tie-break by lexicographic eventId (greater wins).
        guard let localEventId else { return true }
        return incomingEventId > localEventId
    }

    // MARK: - SQLite plumbing

    private func reload() {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT id, title, created_at, completed_at, due_date, ord, updated_at, deleted_at FROM tasks WHERE deleted_at IS NULL", -1, &stmt, nil) == SQLITE_OK else {
            return
        }

        var loaded: [TaskItem] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard
                let idC = sqlite3_column_text(stmt, 0),
                let titleC = sqlite3_column_text(stmt, 1),
                let id = UUID(uuidString: String(cString: idC))
            else { continue }

            let createdAt = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 2))
            let completedAt: Date? = sqlite3_column_type(stmt, 3) == SQLITE_NULL
                ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3))
            let dueDate: Date? = sqlite3_column_type(stmt, 4) == SQLITE_NULL
                ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 4))
            let order = Int(sqlite3_column_int64(stmt, 5))
            let updatedAt = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 6))
            let deletedAt: Date? = sqlite3_column_type(stmt, 7) == SQLITE_NULL
                ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 7))

            loaded.append(TaskItem(
                id: id,
                title: String(cString: titleC),
                createdAt: createdAt,
                completedAt: completedAt,
                dueDate: dueDate,
                order: order,
                updatedAt: updatedAt,
                deletedAt: deletedAt
            ))
        }
        self.tasks = loaded
    }

    private func exec(_ sql: String, bind: (OpaquePointer?) -> Void) {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        bind(stmt)
        sqlite3_step(stmt)
    }

    private func enqueueUpsert(taskId: UUID) { enqueue(taskId: taskId, op: "upsert") }
    private func enqueueDelete(taskId: UUID) { enqueue(taskId: taskId, op: "delete") }

    private func enqueue(taskId: UUID, op: String) {
        guard let builder = eventBuilder else { return }
        guard let snapshot = currentSnapshot(taskId: taskId, op: op) else { return }
        guard let event = builder(snapshot) else { return }
        exec("INSERT INTO sync_queue (event_id, task_id, op, payload, created_at, sent_at) VALUES (?, ?, ?, ?, ?, NULL)") { stmt in
            sqlite3_bind_text(stmt, 1, event.eventId, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, taskId.uuidString, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 3, op, -1, SQLITE_TRANSIENT)
            _ = event.payloadJSON.withUnsafeBytes { rawBuf -> Int32 in
                if let base = rawBuf.baseAddress {
                    return sqlite3_bind_blob(stmt, 4, base, Int32(event.payloadJSON.count), SQLITE_TRANSIENT)
                } else {
                    return sqlite3_bind_zeroblob(stmt, 4, 0)
                }
            }
            sqlite3_bind_double(stmt, 5, snapshot.updatedAt.timeIntervalSince1970)
        }
    }

    private func currentSnapshot(taskId: UUID, op: String) -> TaskMutationSnapshot? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = "SELECT title, created_at, completed_at, due_date, ord, updated_at, deleted_at FROM tasks WHERE id = ?"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        sqlite3_bind_text(stmt, 1, taskId.uuidString, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        let title = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? ""
        let createdAt = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 1))
        let completedAt: Date? = sqlite3_column_type(stmt, 2) == SQLITE_NULL
            ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 2))
        let dueDate: Date? = sqlite3_column_type(stmt, 3) == SQLITE_NULL
            ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3))
        let order = Int(sqlite3_column_int64(stmt, 4))
        let updatedAt = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 5))
        let deletedAt: Date? = sqlite3_column_type(stmt, 6) == SQLITE_NULL
            ? nil : Date(timeIntervalSince1970: sqlite3_column_double(stmt, 6))
        return TaskMutationSnapshot(
            taskId: taskId,
            op: op,
            title: title,
            createdAt: createdAt,
            completedAt: completedAt,
            dueDate: dueDate,
            order: order,
            updatedAt: updatedAt,
            deletedAt: deletedAt
        )
    }

    private func migrateFromJSONIfNeeded(folder: URL) {
        let jsonURL = folder.appendingPathComponent("tasks.json")
        guard FileManager.default.fileExists(atPath: jsonURL.path) else { return }

        // Skip if db already has rows
        var countStmt: OpaquePointer?
        defer { sqlite3_finalize(countStmt) }
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM tasks", -1, &countStmt, nil) == SQLITE_OK,
           sqlite3_step(countStmt) == SQLITE_ROW,
           sqlite3_column_int64(countStmt, 0) > 0 {
            return
        }

        struct LegacyTask: Decodable {
            var id: UUID
            var title: String
            var createdAt: Date
            var completedAt: Date?
            var order: Int
        }
        guard let data = try? Data(contentsOf: jsonURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let legacy = try? decoder.decode([LegacyTask].self, from: data) else { return }

        sqlite3_exec(db, "BEGIN", nil, nil, nil)
        for t in legacy {
            let updated = max(t.createdAt, t.completedAt ?? t.createdAt)
            exec("INSERT OR REPLACE INTO tasks (id, title, created_at, completed_at, due_date, ord, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)") { stmt in
                sqlite3_bind_text(stmt, 1, t.id.uuidString, -1, SQLITE_TRANSIENT)
                sqlite3_bind_text(stmt, 2, t.title, -1, SQLITE_TRANSIENT)
                sqlite3_bind_double(stmt, 3, t.createdAt.timeIntervalSince1970)
                if let c = t.completedAt {
                    sqlite3_bind_double(stmt, 4, c.timeIntervalSince1970)
                } else {
                    sqlite3_bind_null(stmt, 4)
                }
                sqlite3_bind_int64(stmt, 5, Int64(t.order))
                sqlite3_bind_double(stmt, 6, updated.timeIntervalSince1970)
            }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)

        try? FileManager.default.moveItem(at: jsonURL, to: folder.appendingPathComponent("tasks.json.migrated"))
    }
}
