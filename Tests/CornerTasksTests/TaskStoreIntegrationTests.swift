import XCTest
import SQLite3
@testable import CornerTasks

private let SQLITE_TRANSIENT_TEST = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Integration tests that exercise the real `TaskStore` against a temp-directory
/// SQLite file. The store hard-codes `~/Library/Application Support/CornerTasks`
/// in v0.1.0; we redirect the user's home dir to a per-test temp dir so the same
/// code path runs against an isolated location.
///
/// Note: `setenv("HOME", ...)` is not enough on macOS — Foundation resolves the
/// home dir via `getpwuid()` and ignores `$HOME`. CoreFoundation does honor
/// `CFFIXED_USER_HOME`, which redirects `FileManager.urls(for:.applicationSupportDirectory, in:.userDomainMask)`.
final class TaskStoreIntegrationTests: XCTestCase {
    private var tmpDir: URL!
    private var originalHome: String?
    private var originalCFHome: String?

    override func setUpWithError() throws {
        try super.setUpWithError()
        tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("CornerTasksTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)

        originalHome = ProcessInfo.processInfo.environment["HOME"]
        originalCFHome = ProcessInfo.processInfo.environment["CFFIXED_USER_HOME"]
        setenv("HOME", tmpDir.path, 1)
        setenv("CFFIXED_USER_HOME", tmpDir.path, 1)
    }

    override func tearDownWithError() throws {
        if let originalHome {
            setenv("HOME", originalHome, 1)
        } else {
            unsetenv("HOME")
        }
        if let originalCFHome {
            setenv("CFFIXED_USER_HOME", originalCFHome, 1)
        } else {
            unsetenv("CFFIXED_USER_HOME")
        }
        try? FileManager.default.removeItem(at: tmpDir)
        tmpDir = nil
        try super.tearDownWithError()
    }

    private func dbFolder() -> URL {
        tmpDir
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("CornerTasks", isDirectory: true)
    }

    private func dbPath() -> String {
        dbFolder().appendingPathComponent("tasks.sqlite3").path
    }

    // MARK: - CRUD

    @MainActor
    func testAddPersistsAcrossReopen() {
        do {
            let store = TaskStore()
            store.add("a")
            XCTAssertEqual(store.activeTasks.count, 1)
            XCTAssertEqual(store.activeTasks.first?.title, "a")
        }

        let reopened = TaskStore()
        XCTAssertEqual(reopened.activeTasks.count, 1)
        XCTAssertEqual(reopened.activeTasks.first?.title, "a")
    }

    @MainActor
    func testCompleteMovesTaskToArchive() {
        let store = TaskStore()
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
        let store = TaskStore()
        store.add("with-due")
        let task = store.activeTasks.first!
        let due = Date(timeIntervalSince1970: 1_700_000_000)
        store.setDueDate(task, due: due)

        let reopened = TaskStore()
        let stored = reopened.activeTasks.first!
        XCTAssertNotNil(stored.dueDate)
        XCTAssertEqual(stored.dueDate!.timeIntervalSince1970, due.timeIntervalSince1970, accuracy: 0.001)
    }

    @MainActor
    func testUpdateTitlePersists() {
        let store = TaskStore()
        store.add("old")
        let task = store.activeTasks.first!
        store.updateTitle(task, title: "new")

        let reopened = TaskStore()
        XCTAssertEqual(reopened.activeTasks.first?.title, "new")
    }

    @MainActor
    func testDeleteArchivedRemovesRow() {
        let store = TaskStore()
        store.add("kill-me")
        let task = store.activeTasks.first!
        store.complete(task)
        let archived = store.archivedTasks.first!
        store.deleteArchived(archived)
        XCTAssertEqual(store.archivedTasks.count, 0)

        let reopened = TaskStore()
        XCTAssertEqual(reopened.activeTasks.count, 0)
        XCTAssertEqual(reopened.archivedTasks.count, 0)
    }

    @MainActor
    func testMoveActiveReordersPersistently() {
        let store = TaskStore()
        store.add("a")
        store.add("b")
        store.add("c")
        XCTAssertEqual(store.activeTasks.map(\.title), ["a", "b", "c"])

        // Move "c" (index 2) to the front.
        store.moveActive(from: IndexSet(integer: 2), to: 0)
        XCTAssertEqual(store.activeTasks.map(\.title), ["c", "a", "b"])

        let reopened = TaskStore()
        XCTAssertEqual(reopened.activeTasks.map(\.title), ["c", "a", "b"])
    }

    // MARK: - Migrations

    @MainActor
    func testJSONMigrationImportsRowsAndRenamesFile() throws {
        let folder = dbFolder()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let jsonURL = folder.appendingPathComponent("tasks.json")

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

        let store = TaskStore()
        XCTAssertEqual(store.activeTasks.count, 1)
        XCTAssertEqual(store.activeTasks.first?.title, "legacy-1")
        XCTAssertEqual(store.archivedTasks.count, 1)
        XCTAssertEqual(store.archivedTasks.first?.title, "legacy-2")

        XCTAssertFalse(FileManager.default.fileExists(atPath: jsonURL.path))
        let migrated = folder.appendingPathComponent("tasks.json.migrated")
        XCTAssertTrue(FileManager.default.fileExists(atPath: migrated.path))
    }

    @MainActor
    func testSchemaUpgradeAddsDueDateColumn() throws {
        let folder = dbFolder()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

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
        _ = TaskStore()

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
