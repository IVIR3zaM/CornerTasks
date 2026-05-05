import SwiftUI

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
