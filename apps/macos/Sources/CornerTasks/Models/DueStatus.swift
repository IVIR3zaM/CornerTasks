import SwiftUI

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
