import AppKit
import Foundation
import SQLite3

let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class TaskStore: ObservableObject {
    @Published private(set) var tasks: [TaskItem] = []
    @Published var showInDock: Bool = Prefs.showInDock {
        didSet {
            Prefs.showInDock = showInDock
            (NSApp.delegate as? AppDelegate)?.applyActivationPolicy()
        }
    }

    private var db: OpaquePointer?

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
        exec("INSERT INTO tasks (id, title, created_at, completed_at, due_date, ord) VALUES (?, ?, ?, NULL, NULL, ?)") { stmt in
            sqlite3_bind_text(stmt, 1, item.id.uuidString, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, item.title, -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(stmt, 3, item.createdAt.timeIntervalSince1970)
            sqlite3_bind_int64(stmt, 4, Int64(item.order))
        }
        reload()
    }

    func setDueDate(_ item: TaskItem, due: Date?) {
        exec("UPDATE tasks SET due_date = ? WHERE id = ?") { stmt in
            if let d = due {
                sqlite3_bind_double(stmt, 1, d.timeIntervalSince1970)
            } else {
                sqlite3_bind_null(stmt, 1)
            }
            sqlite3_bind_text(stmt, 2, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        reload()
    }

    func complete(_ item: TaskItem) {
        exec("UPDATE tasks SET completed_at = ? WHERE id = ?") { stmt in
            sqlite3_bind_double(stmt, 1, Date().timeIntervalSince1970)
            sqlite3_bind_text(stmt, 2, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        reload()
    }

    func updateTitle(_ item: TaskItem, title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        exec("UPDATE tasks SET title = ? WHERE id = ?") { stmt in
            sqlite3_bind_text(stmt, 1, trimmed, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        reload()
    }

    func deleteArchived(_ item: TaskItem) {
        exec("DELETE FROM tasks WHERE id = ?") { stmt in
            sqlite3_bind_text(stmt, 1, item.id.uuidString, -1, SQLITE_TRANSIENT)
        }
        reload()
    }

    func moveActive(from source: IndexSet, to destination: Int) {
        var active = activeTasks
        active.move(fromOffsets: source, toOffset: destination)
        sqlite3_exec(db, "BEGIN", nil, nil, nil)
        for (idx, item) in active.enumerated() {
            exec("UPDATE tasks SET ord = ? WHERE id = ?") { stmt in
                sqlite3_bind_int64(stmt, 1, Int64(idx))
                sqlite3_bind_text(stmt, 2, item.id.uuidString, -1, SQLITE_TRANSIENT)
            }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)
        reload()
    }

    // MARK: - SQLite plumbing

    private func reload() {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT id, title, created_at, completed_at, due_date, ord FROM tasks", -1, &stmt, nil) == SQLITE_OK else {
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

            loaded.append(TaskItem(
                id: id,
                title: String(cString: titleC),
                createdAt: createdAt,
                completedAt: completedAt,
                dueDate: dueDate,
                order: order
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
            exec("INSERT OR REPLACE INTO tasks (id, title, created_at, completed_at, due_date, ord) VALUES (?, ?, ?, ?, NULL, ?)") { stmt in
                sqlite3_bind_text(stmt, 1, t.id.uuidString, -1, SQLITE_TRANSIENT)
                sqlite3_bind_text(stmt, 2, t.title, -1, SQLITE_TRANSIENT)
                sqlite3_bind_double(stmt, 3, t.createdAt.timeIntervalSince1970)
                if let c = t.completedAt {
                    sqlite3_bind_double(stmt, 4, c.timeIntervalSince1970)
                } else {
                    sqlite3_bind_null(stmt, 4)
                }
                sqlite3_bind_int64(stmt, 5, Int64(t.order))
            }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)

        try? FileManager.default.moveItem(at: jsonURL, to: folder.appendingPathComponent("tasks.json.migrated"))
    }
}
