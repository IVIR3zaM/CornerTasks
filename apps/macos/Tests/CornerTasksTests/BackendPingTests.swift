import XCTest
@testable import CornerTasks

final class BackendPingTests: XCTestCase {
    func testPingURLStripsTrailingSlashAndPointsAtChallengeEndpoint() {
        let url = BackendPing.pingURL(
            apiUrl: "https://abc.execute-api.us-east-1.amazonaws.com/Prod/"
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://abc.execute-api.us-east-1.amazonaws.com/Prod/v1/auth/challenge"
        )
    }

    func testPingURLAppendsPathWhenNoTrailingSlash() {
        let url = BackendPing.pingURL(apiUrl: "https://abc.example.com")
        XCTAssertEqual(url?.absoluteString, "https://abc.example.com/v1/auth/challenge")
    }

    func testPingURLReturnsNilForEmptyInput() {
        XCTAssertNil(BackendPing.pingURL(apiUrl: "   "))
    }

    func testPingURLReturnsNilForGarbage() {
        XCTAssertNil(BackendPing.pingURL(apiUrl: "ht tp://bad url"))
    }
}
