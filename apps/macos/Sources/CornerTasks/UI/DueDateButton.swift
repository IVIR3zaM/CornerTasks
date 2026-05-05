import SwiftUI

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
