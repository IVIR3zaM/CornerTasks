import SwiftUI

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
