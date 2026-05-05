import XCTest
import SQLite3
@testable import CornerTasks

private let SQLITE_TRANSIENT_TEST = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Integration tests that exercise the real `TaskStore` against a temp-directory
/// SQLite file. Iteration 2 introduces `TaskStore.init(directory:)`, so tests no
/// longer need the `HOME` / `CFFIXED_USER_HOME` override — they pass an explicit
/// per-test directory. The integration assertions themselves are unchanged from
/// iteration 1.
final class TaskStoreIntegrationTests: XCTestCase {
    private var tmpDir: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("CornerTasksTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
        tmpDir = nil
        try super.tearDownWithError()
    }

    private func makeStore() -> TaskStore {
        TaskStore(directory: tmpDir)
    }

    private func dbPath() -> String {
        tmpDir.appendingPathComponent("tasks.sqlite3").path
    }

    // MARK: - CRUD

    @MainActor
    func testAddPersistsAcrossReopen() {
        do {
            let store = makeStore()
            store.add("a")
            XCTAssertEqual(store.activeTasks.count, 1)
            XCTAssertEqual(store.activeTasks.first?.title, "a")
        }

        let reopened = makeStore()
        XCTAssertEqual(reopened.activeTasks.count, 1)
        XCTAssertEqual(reopened.activeTasks.first?.title, "a")
    }

    @MainActor
    func testCompleteMovesTaskToArchive() {
        let store = makeStore()
        store.add("done-me")
        let task = store.activeTasks.first!
        store.complete(task)
        XCTAssertEqual(store.activeTasks.count, 0)
        XCTAssertEqual(store.archivedTasks.count, 1)
        XCTAssertEqual(store.archivedTasks.first?.title, "done-me")
        XCTAssertNotNil(store.archivedTasks.first?.completedAt)
    }

    @MainActor
    func testSetDueDateRoundTrips() {
        let store = makeStore()
        store.add("with-due")
        let task = store.activeTasks.first!
        let due = Date(timeIntervalSince1970: 1_700_000_000)
        store.setDueDate(task, due: due)

        let reopened = makeStore()
        let stored = reopened.activeTasks.first!
        XCTAssertNotNil(stored.dueDate)
        XCTAssertEqual(stored.dueDate!.timeIntervalSince1970, due.timeIntervalSince1970, accuracy: 0.001)
    }

    @MainActor
    func testUpdateTitlePersists() {
        let store = makeStore()
        store.add("old")
        let task = store.activeTasks.first!
        store.updateTitle(task, title: "new")

        let reopened = makeStore()
        XCTAssertEqual(reopened.activeTasks.first?.title, "new")
    }

    @MainActor
    func testDeleteArchivedRemovesRow() {
        let store = makeStore()
        store.add("kill-me")
        let task = store.activeTasks.first!
        store.complete(task)
        let archived = store.archivedTasks.first!
        store.deleteArchived(archived)
        XCTAssertEqual(store.archivedTasks.count, 0)

        let reopened = makeStore()
        XCTAssertEqual(reopened.activeTasks.count, 0)
        XCTAssertEqual(reopened.archivedTasks.count, 0)
    }

    @MainActor
    func testMoveActiveReordersPersistently() {
        let store = makeStore()
        store.add("a")
        store.add("b")
        store.add("c")
        XCTAssertEqual(store.activeTasks.map(\.title), ["a", "b", "c"])

        // Move "c" (index 2) to the front.
        store.moveActive(from: IndexSet(integer: 2), to: 0)
        XCTAssertEqual(store.activeTasks.map(\.title), ["c", "a", "b"])

        let reopened = makeStore()
        XCTAssertEqual(reopened.activeTasks.map(\.title), ["c", "a", "b"])
    }

    // MARK: - Migrations

    @MainActor
    func testJSONMigrationImportsRowsAndRenamesFile() throws {
        let jsonURL = tmpDir.appendingPathComponent("tasks.json")

        let json = """
        [
          {
            "id": "11111111-1111-1111-1111-111111111111",
            "title": "legacy-1",
            "createdAt": "2023-01-01T00:00:00Z",
            "completedAt": null,
            "order": 0
          },
          {
            "id": "22222222-2222-2222-2222-222222222222",
            "title": "legacy-2",
            "createdAt": "2023-01-02T00:00:00Z",
            "completedAt": "2023-01-03T00:00:00Z",
            "order": 1
          }
        ]
        """
        try json.data(using: .utf8)!.write(to: jsonURL)

        let store = makeStore()
        XCTAssertEqual(store.activeTasks.count, 1)
        XCTAssertEqual(store.activeTasks.first?.title, "legacy-1")
        XCTAssertEqual(store.archivedTasks.count, 1)
        XCTAssertEqual(store.archivedTasks.first?.title, "legacy-2")

        XCTAssertFalse(FileManager.default.fileExists(atPath: jsonURL.path))
        let migrated = tmpDir.appendingPathComponent("tasks.json.migrated")
        XCTAssertTrue(FileManager.default.fileExists(atPath: migrated.path))
    }

    @MainActor
    func testSchemaUpgradeAddsDueDateColumn() throws {
        // Pre-create a tasks table that lacks `due_date`.
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbPath(), &db), SQLITE_OK)
        let createSQL = """
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at REAL NOT NULL,
              completed_at REAL,
              ord INTEGER NOT NULL DEFAULT 0
            );
        """
        XCTAssertEqual(sqlite3_exec(db, createSQL, nil, nil, nil), SQLITE_OK)
        XCTAssertFalse(columnExists(db: db, table: "tasks", column: "due_date"))
        sqlite3_close(db)

        // Opening the real store should add the column.
        _ = makeStore()

        var db2: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbPath(), &db2), SQLITE_OK)
        defer { sqlite3_close(db2) }
        XCTAssertTrue(columnExists(db: db2, table: "tasks", column: "due_date"))
    }

    private func columnExists(db: OpaquePointer?, table: String, column: String) -> Bool {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "PRAGMA table_info(\(table));", -1, &stmt, nil) == SQLITE_OK else {
            return false
        }
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let cName = sqlite3_column_text(stmt, 1), String(cString: cName) == column {
                return true
            }
        }
        return false
    }
}
