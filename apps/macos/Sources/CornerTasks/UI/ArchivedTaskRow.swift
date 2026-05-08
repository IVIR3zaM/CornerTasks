import SwiftUI

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
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

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
                Text(task.id.uuidString.lowercased())
                    .font(.system(size: 9).monospaced())
                    .opacity(0.55)
                    .textSelection(.enabled)
                    .help("Task ID (debug)")
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
