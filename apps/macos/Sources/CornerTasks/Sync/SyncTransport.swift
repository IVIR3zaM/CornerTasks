import Foundation

struct ChallengeResponse: Decodable, Equatable {
    let challenge: String
    let audience: String
    let expiresAt: String
}

struct TokenResponse: Decodable, Equatable {
    let accessToken: String
    let expiresAt: String
}

struct PushResponse: Decodable, Equatable {
    let accepted: [String]
    let rejected: [Rejected]
    struct Rejected: Decodable, Equatable {
        let eventId: String
        let reason: String
    }
}

struct PullResponse: Decodable, Equatable {
    let events: [SyncEvent]
    let serverTime: String
}

enum SyncTransportError: Error, Equatable {
    case missingToken
    case badToken
    case tokenExpired
    case didMismatch
    case http(Int, reason: String?)
    case decoding
    case network(String)
    case invalidURL
}

protocol SyncTransport: AnyObject {
    func challenge(accountDid: String) async throws -> ChallengeResponse
    func token(accountDid: String, didJwt: String) async throws -> TokenResponse
    func push(accountDid: String, events: [SyncEvent], bearer: String) async throws -> PushResponse
    func pull(accountDid: String, since: String, bearer: String) async throws -> PullResponse
}

/// Talks to a real `ApiUrl`. The auth-failure cases are preserved so the
/// `SyncEngine` can drop and refresh the cached bearer on `bad_token`/`token_expired`.
final class URLSessionSyncTransport: SyncTransport {
    private let baseURL: URL
    private let session: URLSession

    init?(apiUrl: String, session: URLSession = .shared) {
        let trimmed = apiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let stripped = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        guard let url = URL(string: stripped) else { return nil }
        self.baseURL = url
        self.session = session
    }

    func challenge(accountDid: String) async throws -> ChallengeResponse {
        let body = try JSONSerialization.data(withJSONObject: ["accountDid": accountDid])
        return try await postJSON(path: "/v1/auth/challenge", body: body, bearer: nil, decode: ChallengeResponse.self)
    }

    func token(accountDid: String, didJwt: String) async throws -> TokenResponse {
        let body = try JSONSerialization.data(withJSONObject: ["accountDid": accountDid, "didJwt": didJwt])
        return try await postJSON(path: "/v1/auth/token", body: body, bearer: nil, decode: TokenResponse.self)
    }

    func push(accountDid: String, events: [SyncEvent], bearer: String) async throws -> PushResponse {
        let encoder = JSONEncoder()
        let body = try encoder.encode(PushBody(accountDid: accountDid, events: events))
        return try await postJSON(path: "/v1/sync/push", body: body, bearer: bearer, decode: PushResponse.self)
    }

    func pull(accountDid: String, since: String, bearer: String) async throws -> PullResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("v1/sync/pull"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "accountDid", value: accountDid),
            URLQueryItem(name: "since", value: since)
        ]
        guard let url = comps.url else { throw SyncTransportError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        return try await perform(req, decode: PullResponse.self)
    }

    private struct PushBody: Encodable {
        let accountDid: String
        let events: [SyncEvent]
    }

    private func postJSON<T: Decodable>(path: String, body: Data, bearer: String?, decode: T.Type) async throws -> T {
        let url = baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        req.httpBody = body
        return try await perform(req, decode: T.self)
    }

    private func perform<T: Decodable>(_ req: URLRequest, decode: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw SyncTransportError.network(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else { throw SyncTransportError.network("non-HTTP response") }
        if http.statusCode == 401 {
            let reason = errorReason(in: data)
            switch reason {
            case "token_expired": throw SyncTransportError.tokenExpired
            case "bad_token", "missing_token", "bad_signature", "bad_audience", "unknown_challenge", "bad_lifetime":
                throw SyncTransportError.badToken
            default: throw SyncTransportError.http(401, reason: reason)
            }
        }
        if http.statusCode == 403 {
            let reason = errorReason(in: data)
            if reason == "did_mismatch" { throw SyncTransportError.didMismatch }
            throw SyncTransportError.http(403, reason: reason)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncTransportError.http(http.statusCode, reason: errorReason(in: data))
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw SyncTransportError.decoding
        }
    }

    private func errorReason(in data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["reason"] as? String
    }
}
