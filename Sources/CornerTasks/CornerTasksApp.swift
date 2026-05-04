import SwiftUI
import AppKit
import SQLite3

@main
struct CornerTasksApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

enum Prefs {
    static let showInDockKey = "showInDock"

    static var showInDock: Bool {
        get {
            if UserDefaults.standard.object(forKey: showInDockKey) == nil { return true }
            return UserDefaults.standard.bool(forKey: showInDockKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: showInDockKey) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: NSPanel?
    private var statusItem: NSStatusItem?
    private let store = TaskStore()

    func applicationDidFinishLaunching(_ notification: Notification) {
        applyActivationPolicy()
        setupStatusItem()
        showPanel()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPanel()
        return true
    }

    fileprivate func applyActivationPolicy() {
        NSApp.setActivationPolicy(Prefs.showInDock ? .regular : .accessory)
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "✓"
        item.button?.toolTip = "Corner Tasks"

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show / Hide", action: #selector(togglePanel), keyEquivalent: "t"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Corner Tasks", action: #selector(quit), keyEquivalent: "q"))
        item.menu = menu
        self.statusItem = item
    }

    fileprivate func showPanel() {
        if panel == nil {
            let content = ContentView(store: store)
            let hosting = NSHostingController(rootView: content)

            let p = NSPanel(
                contentRect: defaultPanelFrame(),
                styleMask: [.nonactivatingPanel, .titled, .closable, .fullSizeContentView, .resizable],
                backing: .buffered,
                defer: false
            )

            p.title = "Corner Tasks"
            p.isFloatingPanel = true
            p.level = .floating
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            p.hidesOnDeactivate = false
            p.isReleasedWhenClosed = false
            p.titlebarAppearsTransparent = true
            p.titleVisibility = .hidden
            p.standardWindowButton(.miniaturizeButton)?.isHidden = true
            p.standardWindowButton(.zoomButton)?.isHidden = true
            p.contentViewController = hosting
            p.minSize = NSSize(width: 280, height: 200)
            // Don't let macOS persist a smaller frame from a previous session.
            p.setFrameAutosaveName("")

            self.panel = p
        }

        // Always force the right-edge full-height layout on show.
        panel?.setFrame(defaultPanelFrame(), display: true)
        panel?.orderFrontRegardless()
    }

    private func defaultPanelFrame() -> NSRect {
        let width: CGFloat = 360
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSRect(
            x: screenFrame.maxX - width,
            y: screenFrame.minY,
            width: width,
            height: screenFrame.height
        )
    }

    @objc private func togglePanel() {
        guard let panel else {
            showPanel()
            return
        }

        if panel.isVisible {
            panel.orderOut(nil)
        } else {
            showPanel()
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

struct TaskItem: Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String
    var createdAt: Date = Date()
    var completedAt: Date? = nil
    var dueDate: Date? = nil
    var order: Int = 0

    var isDone: Bool { completedAt != nil }
}

enum DueStatus {
    case overdue, today, tomorrow, future, none

    var color: Color {
        switch self {
        case .overdue: return .red
        case .today: return .orange
        case .tomorrow: return .yellow
        case .future: return .blue
        case .none: return .secondary
        }
    }

    static func of(_ due: Date?, now: Date = Date()) -> DueStatus {
        guard let due else { return .none }
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let dueDay = cal.startOfDay(for: due)
        let days = cal.dateComponents([.day], from: today, to: dueDay).day ?? 0
        if days < 0 { return .overdue }
        if days == 0 { return .today }
        if days == 1 { return .tomorrow }
        return .future
    }
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

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = appSupport.appendingPathComponent("CornerTasks", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let dbURL = folder.appendingPathComponent("tasks.sqlite3")

        if sqlite3_open(dbURL.path, &db) != SQLITE_OK {
            assertionFailure("Failed to open sqlite db at \(dbURL.path)")
        }
        createSchema()
        migrateFromJSONIfNeeded(folder: folder)
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

    private func createSchema() {
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
        if !columnExists(table: "tasks", column: "due_date") {
            sqlite3_exec(db, "ALTER TABLE tasks ADD COLUMN due_date REAL;", nil, nil, nil)
        }
    }

    private func columnExists(table: String, column: String) -> Bool {
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

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct ContentView: View {
    @ObservedObject var store: TaskStore

    @State private var newTaskTitle = ""
    @State private var selectedTab: Tab = .active
    @State private var showSettings = false

    enum Tab: String, CaseIterable {
        case active = "Tasks"
        case archive = "Archive"
    }

    var body: some View {
        VStack(spacing: 14) {
            header
            tabPicker

            if showSettings {
                settingsView
            } else if selectedTab == .active {
                addBox
                activeList
            } else {
                archiveList
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(minWidth: 280, minHeight: 200)
        .background(.ultraThinMaterial)
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Corner Tasks")
                    .font(.system(size: 22, weight: .bold, design: .rounded))

                Text("\(store.activeTasks.count) open • \(store.archivedTasks.count) archived")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                showSettings.toggle()
            } label: {
                Image(systemName: showSettings ? "xmark.circle.fill" : "gearshape")
                    .font(.system(size: 16))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
    }

    private var tabPicker: some View {
        Picker("", selection: $selectedTab) {
            ForEach(Tab.allCases, id: \.self) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .disabled(showSettings)
    }

    private var settingsView: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle("Show icon in Dock", isOn: $store.showInDock)
                .toggleStyle(.switch)

            Text("Changes apply immediately. The menu bar icon stays visible either way.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.primary.opacity(0.06))
        )
    }

    private var addBox: some View {
        HStack(spacing: 8) {
            TextField("Add a task…", text: $newTaskTitle)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .onSubmit(addTask)

            Button(action: addTask) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .bold))
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .keyboardShortcut(.return, modifiers: [.command])
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.primary.opacity(0.06))
        )
    }

    private var activeList: some View {
        List {
            ForEach(store.activeTasks) { task in
                ActiveTaskRow(
                    task: task,
                    onComplete: { store.complete(task) },
                    onRename: { title in store.updateTitle(task, title: title) },
                    onSetDue: { date in store.setDueDate(task, due: date) }
                )
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
            .onMove(perform: store.moveActive)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if store.activeTasks.isEmpty {
                emptyState("Nothing on your head. Nice.")
            }
        }
    }

    private var archiveList: some View {
        List {
            ForEach(store.archivedTasks) { task in
                ArchivedTaskRow(
                    task: task,
                    onDelete: { store.deleteArchived(task) }
                )
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if store.archivedTasks.isEmpty {
                emptyState("No completed tasks yet.")
            }
        }
    }

    private func emptyState(_ text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)

            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private func addTask() {
        store.add(newTaskTitle)
        newTaskTitle = ""
    }
}

struct ActiveTaskRow: View {
    let task: TaskItem
    let onComplete: () -> Void
    let onRename: (String) -> Void
    let onSetDue: (Date?) -> Void

    @State private var isEditing = false
    @State private var draftTitle = ""
    @FocusState private var titleFocused: Bool

    var body: some View {
        let status = DueStatus.of(task.dueDate)

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button(action: onComplete) {
                    Image(systemName: "circle")
                        .font(.system(size: 18, weight: .semibold))
                }
                .buttonStyle(.plain)

                if isEditing {
                    TextField("", text: $draftTitle)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 15, weight: .medium))
                        .focused($titleFocused)
                        .onSubmit(commit)
                        .onExitCommand { cancel() }

                    Button(action: commit) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.green)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(task.title)
                        .font(.system(size: 15, weight: .medium))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { startEditing() }

                    Button(action: startEditing) {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Edit task")
                }

                DueDateButton(due: task.dueDate, status: status, onSet: onSetDue)

                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: 8) {
                Label(task.createdAt.formatted(date: .abbreviated, time: .omitted),
                      systemImage: "calendar")
                    .labelStyle(.titleAndIcon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if let due = task.dueDate {
                    Spacer()
                    DueBadge(due: due, status: status)
                }
            }
            .padding(.leading, 28)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(rowFill(status: status))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(rowBorder(status: status), lineWidth: 1)
        )
    }

    private func rowFill(status: DueStatus) -> Color {
        switch status {
        case .overdue: return Color.red.opacity(0.14)
        case .today:   return Color.orange.opacity(0.14)
        case .tomorrow: return Color.yellow.opacity(0.12)
        default:       return Color.primary.opacity(0.055)
        }
    }

    private func rowBorder(status: DueStatus) -> Color {
        switch status {
        case .overdue, .today, .tomorrow: return status.color.opacity(0.5)
        default: return .clear
        }
    }

    private func startEditing() {
        draftTitle = task.title
        isEditing = true
        DispatchQueue.main.async { titleFocused = true }
    }

    private func commit() {
        onRename(draftTitle)
        isEditing = false
    }

    private func cancel() {
        draftTitle = task.title
        isEditing = false
    }
}

struct DueDateButton: View {
    let due: Date?
    let status: DueStatus
    let onSet: (Date?) -> Void

    @State private var showPopover = false
    @State private var draft: Date = Date()

    var body: some View {
        Button {
            draft = due ?? Date()
            showPopover = true
        } label: {
            Image(systemName: due == nil ? "calendar.badge.plus" : "calendar")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(due == nil ? Color.secondary : status.color)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showPopover) {
            VStack(alignment: .leading, spacing: 10) {
                DatePicker("Due", selection: $draft, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()

                HStack {
                    if due != nil {
                        Button("Clear", role: .destructive) {
                            onSet(nil)
                            showPopover = false
                        }
                    }
                    Spacer()
                    Button("Save") {
                        onSet(Calendar.current.startOfDay(for: draft))
                        showPopover = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(12)
            .frame(width: 280)
        }
    }
}

struct DueBadge: View {
    let due: Date
    let status: DueStatus

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(status.color.opacity(0.22))
            )
            .foregroundStyle(status.color)
    }

    private var label: String {
        let prefix: String
        switch status {
        case .overdue: prefix = "Overdue"
        case .today: prefix = "Today"
        case .tomorrow: prefix = "Tomorrow"
        case .future, .none: prefix = "Due"
        }
        return "\(prefix) · \(due.formatted(date: .abbreviated, time: .omitted))"
    }
}

struct ArchivedTaskRow: View {
    let task: TaskItem
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.secondary)

                Text(task.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(2)

                Spacer()

                Button(action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text("Added: \(task.createdAt.formatted(date: .abbreviated, time: .shortened))")
                Text("Done: \(task.completedAt?.formatted(date: .abbreviated, time: .shortened) ?? "—")")
                if task.dueDate != nil {
                    HStack(spacing: 6) {
                        Text("Due:")
                        DueBadge(due: task.dueDate!, status: DueStatus.of(task.dueDate))
                    }
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.leading, 27)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.primary.opacity(0.055))
        )
    }
}
