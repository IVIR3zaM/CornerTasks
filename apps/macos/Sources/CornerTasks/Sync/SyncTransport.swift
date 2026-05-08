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
        let method = req.httpMethod ?? "GET"
        let path = req.url?.path ?? ""
        let bodyBytes = req.httpBody?.count ?? 0
        let hasBearer = req.value(forHTTPHeaderField: "Authorization") != nil

        var fields: [String: Any] = [
            "method": method, "path": path, "bodyBytes": bodyBytes, "hasBearer": hasBearer
        ]
        if let comps = req.url.flatMap({ URLComponents(url: $0, resolvingAgainstBaseURL: false) }),
           let items = comps.queryItems, !items.isEmpty {
            var qs: [String: String] = [:]
            for item in items { qs[item.name] = item.value ?? "" }
            fields["query"] = qs
        }
        if let body = req.httpBody, let summary = Self.redactedBodySummary(path: path, body: body) {
            fields["body"] = summary
        }
        DiagLog.shared.record("http.request", fields)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            DiagLog.shared.record("http.transport_error", [
                "method": method, "path": path, "error": String(describing: error)
            ])
            throw SyncTransportError.network(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            DiagLog.shared.record("http.non_http_response", ["method": method, "path": path])
            throw SyncTransportError.network("non-HTTP response")
        }
        DiagLog.shared.record("http.response", [
            "method": method, "path": path,
            "status": http.statusCode, "responseBytes": data.count,
            // For 4xx/5xx the body is usually our own server's JSON error — safe and useful.
            "errorBody": (http.statusCode >= 400) ? (String(data: data, encoding: .utf8) ?? "") : ""
        ])
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

    /// Returns a JSON-safe redacted summary of an outbound POST body, suitable
    /// for the diagnostic log. Drops `ciphertext`, `nonce`, `didJwt` and other
    /// secret-bearing fields; keeps routing metadata (eventId, op, taskId,
    /// updatedAt, deviceId) so missing-update bugs are diagnosable.
    static func redactedBodySummary(path: String, body: Data) -> Any? {
        guard let json = try? JSONSerialization.jsonObject(with: body) else { return nil }

        // POST /v1/sync/push — { accountDid, events: [SyncEvent] }
        if path.hasSuffix("/v1/sync/push"), let dict = json as? [String: Any] {
            var summary: [String: Any] = [:]
            if let did = dict["accountDid"] as? String { summary["accountDid"] = did }
            if let events = dict["events"] as? [[String: Any]] {
                summary["eventCount"] = events.count
                summary["events"] = events.map { ev -> [String: Any] in
                    var e: [String: Any] = [:]
                    for k in ["eventId", "op", "taskId", "updatedAt", "deviceId", "accountDid"] {
                        if let v = ev[k] { e[k] = v }
                    }
                    if let ct = ev["ciphertext"] as? String { e["ciphertextLength"] = ct.count }
                    if let n = ev["nonce"] as? String { e["nonceLength"] = n.count }
                    return e
                }
            }
            return summary
        }

        // POST /v1/auth/token — { accountDid, didJwt }. Redact the JWT.
        if path.hasSuffix("/v1/auth/token"), let dict = json as? [String: Any] {
            var summary: [String: Any] = [:]
            if let did = dict["accountDid"] as? String { summary["accountDid"] = did }
            if let jwt = dict["didJwt"] as? String { summary["didJwtLength"] = jwt.count }
            return summary
        }

        // POST /v1/auth/challenge — { accountDid }. Safe to log as-is.
        if path.hasSuffix("/v1/auth/challenge") {
            return json
        }

        return nil
    }
}
