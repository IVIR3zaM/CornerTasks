import XCTest
@testable import CornerTasks

final class AuthSessionTests: XCTestCase {

    private func makeIdentity() throws -> Identity {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
        return try Identity.fromBip39Seed(Mnemonic.toSeed(mnemonic))
    }

    func testCachesTokenUntilNearExpiry() async throws {
        let identity = try makeIdentity()
        let transport = FakeTransport()
        let session = AuthSession(identity: identity, transport: transport, refreshSlack: 60)

        let t1 = try await session.bearer()
        let t2 = try await session.bearer()
        XCTAssertEqual(t1, t2)
        XCTAssertEqual(transport.tokenCalls, 1)
    }

    func testRefreshesProactivelyBeforeExpiry() async throws {
        let identity = try makeIdentity()
        let transport = FakeTransport()
        // Issue tokens that expire in 30 seconds — within the 60 s refresh slack.
        transport.tokenExpiresIn = 30
        let session = AuthSession(identity: identity, transport: transport, refreshSlack: 60)

        _ = try await session.bearer()
        _ = try await session.bearer()
        XCTAssertGreaterThanOrEqual(transport.tokenCalls, 2,
            "should have re-fetched at least once when cached token is within refresh slack")
    }

    func testInvalidateForcesRefresh() async throws {
        let identity = try makeIdentity()
        let transport = FakeTransport()
        let session = AuthSession(identity: identity, transport: transport)

        let first = try await session.bearer()
        await session.invalidate()
        let second = try await session.bearer()
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(transport.tokenCalls, 2)
    }

    func testTokenNeverPersistedToDisk() async throws {
        let identity = try makeIdentity()
        let transport = FakeTransport()
        let session = AuthSession(identity: identity, transport: transport)

        _ = try await session.bearer()
        // The cache is in-memory only — `cachedTokenForTesting` is the only accessor.
        // A new AuthSession built against the same transport must NOT see the old token.
        let fresh = AuthSession(identity: identity, transport: transport)
        let cached = await fresh.cachedTokenForTesting()
        XCTAssertNil(cached)
    }
}
