import Foundation
import SQLite3

enum Schema {
    static func create(db: OpaquePointer?) {
        sqlite3_exec(db, """
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at REAL NOT NULL,
              completed_at REAL,
              due_date REAL,
              ord INTEGER NOT NULL DEFAULT 0
            );
        """, nil, nil, nil)

        // Lightweight migration: add due_date if upgrading from a v0.1.0 db
        // that pre-dated this column. SQLite has no IF NOT EXISTS for ADD COLUMN.
        if !columnExists(db: db, table: "tasks", column: "due_date") {
            sqlite3_exec(db, "ALTER TABLE tasks ADD COLUMN due_date REAL;", nil, nil, nil)
        }

        // Iteration 11: per-row last-mutation timestamp + soft-delete tombstone.
        let needsUpdatedAt = !columnExists(db: db, table: "tasks", column: "updated_at")
        if needsUpdatedAt {
            // Add nullable first; backfill; then keep nullable (SQLite ALTER cannot
            // tighten NULL constraints in-place — readers treat 0 as "unset" and the
            // backfill below sets a real value for every existing row).
            sqlite3_exec(db, "ALTER TABLE tasks ADD COLUMN updated_at REAL;", nil, nil, nil)
            sqlite3_exec(db, """
                UPDATE tasks
                SET updated_at = MAX(
                    COALESCE(created_at, 0),
                    COALESCE(completed_at, 0),
                    COALESCE(due_date, 0)
                )
                WHERE updated_at IS NULL;
            """, nil, nil, nil)
        }
        if !columnExists(db: db, table: "tasks", column: "deleted_at") {
            sqlite3_exec(db, "ALTER TABLE tasks ADD COLUMN deleted_at REAL;", nil, nil, nil)
        }

        sqlite3_exec(db, """
            CREATE TABLE IF NOT EXISTS sync_queue (
              event_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              op TEXT NOT NULL,
              payload BLOB NOT NULL,
              created_at REAL NOT NULL,
              sent_at REAL
            );
        """, nil, nil, nil)
    }

    static func columnExists(db: OpaquePointer?, table: String, column: String) -> Bool {
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
