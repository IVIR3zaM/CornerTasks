import XCTest
@testable import CornerTasks

final class BackendPingTests: XCTestCase {
    func testPingURLEncodesQueryAndStripsTrailingSlash() {
        let url = BackendPing.pingURL(
            apiUrl: "https://abc.execute-api.us-east-1.amazonaws.com/Prod/",
            accountDid: "did:key:z6MkExample"
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://abc.execute-api.us-east-1.amazonaws.com/Prod/v1/sync/pull?accountDid=did:key:z6MkExample&since=2099-01-01T00:00:00Z"
        )
    }

    func testPingURLAppendsPathWhenNoTrailingSlash() {
        let url = BackendPing.pingURL(
            apiUrl: "https://abc.example.com",
            accountDid: "did:key:z6MkA"
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://abc.example.com/v1/sync/pull?accountDid=did:key:z6MkA&since=2099-01-01T00:00:00Z"
        )
    }

    func testPingURLReturnsNilForEmptyInput() {
        XCTAssertNil(BackendPing.pingURL(apiUrl: "   ", accountDid: "did:key:z"))
    }

    func testPingURLReturnsNilForGarbage() {
        // URLComponents accepts a lot, but a string with control characters fails.
        XCTAssertNil(BackendPing.pingURL(apiUrl: "ht tp://bad url", accountDid: "did:key:z"))
    }
}
