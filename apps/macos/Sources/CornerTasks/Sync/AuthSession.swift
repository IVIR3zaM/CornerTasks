import Foundation

/// Owns the bearer-token lifecycle per `docs/sync-protocol.md` §8.
///
/// The token is held in memory only — never written to UserDefaults, the Keychain,
/// or the SQLite store. On expiry, on first use, or after a `bad_token`/`token_expired`
/// drop, the session re-runs the challenge → DID-JWT → token exchange.
actor AuthSession {
    private let identity: Identity
    private let transport: SyncTransport
    private let now: () -> Date
    private let refreshSlack: TimeInterval

    private var cachedToken: String?
    private var cachedExpiresAt: Date?

    init(identity: Identity,
         transport: SyncTransport,
         now: @escaping () -> Date = Date.init,
         refreshSlack: TimeInterval = 60) {
        self.identity = identity
        self.transport = transport
        self.now = now
        self.refreshSlack = refreshSlack
    }

    /// Returns a valid bearer token, refreshing if absent or within `refreshSlack`
    /// of expiry.
    func bearer() async throws -> String {
        if let token = cachedToken,
           let expiresAt = cachedExpiresAt,
           expiresAt.timeIntervalSince(now()) > refreshSlack {
            return token
        }
        return try await refresh()
    }

    /// Drops the cached token. Called by the engine after a `bad_token`/`token_expired`.
    func invalidate() {
        cachedToken = nil
        cachedExpiresAt = nil
    }

    /// Test hook — exposed so tests can assert "no token written to disk" by checking
    /// the in-memory cache directly.
    func cachedTokenForTesting() -> String? { cachedToken }

    private func refresh() async throws -> String {
        let challenge = try await transport.challenge(accountDid: identity.accountDid)
        let iat = Int(now().timeIntervalSince1970)
        let didJwt = try identity.makeDidJwt(audience: challenge.audience, nonce: challenge.challenge, iat: iat)
        let token = try await transport.token(accountDid: identity.accountDid, didJwt: didJwt)
        cachedToken = token.accessToken
        cachedExpiresAt = ISO8601.parse(token.expiresAt) ?? now().addingTimeInterval(3600)
        return token.accessToken
    }
}
