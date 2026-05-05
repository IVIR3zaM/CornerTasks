import Foundation

struct TaskItem: Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String
    var createdAt: Date = Date()
    var completedAt: Date? = nil
    var dueDate: Date? = nil
    var order: Int = 0

    var isDone: Bool { completedAt != nil }
}
