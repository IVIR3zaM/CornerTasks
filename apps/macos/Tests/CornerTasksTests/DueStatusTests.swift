import XCTest
@testable import CornerTasks

final class DueStatusTests: XCTestCase {
    /// Fixed reference "now": 2024-06-15 12:00:00 UTC. Using `Calendar.current`
    /// matches the production code, and start-of-day boundaries hold regardless
    /// of which timezone the test host is in because we anchor offsets with the
    /// same calendar.
    private let now = Date(timeIntervalSince1970: 1_718_452_800)

    private func date(daysFrom now: Date, days: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: days, to: Calendar.current.startOfDay(for: now))!
    }

    func testNoneWhenDueIsNil() {
        XCTAssertEqual(DueStatus.of(nil, now: now), .none)
    }

    func testOverdueWhenYesterday() {
        let due = date(daysFrom: now, days: -1)
        XCTAssertEqual(DueStatus.of(due, now: now), .overdue)
    }

    func testTodayWhenSameDay() {
        let due = date(daysFrom: now, days: 0)
        XCTAssertEqual(DueStatus.of(due, now: now), .today)
    }

    func testTomorrowWhenOneDayAhead() {
        let due = date(daysFrom: now, days: 1)
        XCTAssertEqual(DueStatus.of(due, now: now), .tomorrow)
    }

    func testFutureWhenMoreThanOneDayAhead() {
        let due = date(daysFrom: now, days: 5)
        XCTAssertEqual(DueStatus.of(due, now: now), .future)
    }
}
