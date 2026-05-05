import SwiftUI

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
