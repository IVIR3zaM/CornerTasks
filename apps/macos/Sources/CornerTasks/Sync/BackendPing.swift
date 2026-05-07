import Foundation

enum BackendPingError: Error, Equatable {
    case invalidURL
    case http(Int, reason: String?)
    case unexpectedResponse
    case audienceMismatch(expected: String, got: String)
    case transport(String)
}

/// Reachability + shape check for a user-supplied `ApiUrl`.
///
/// Hits `POST /v1/auth/challenge` with the user's `accountDid`. That endpoint is the
/// only sync-protocol endpoint that does **not** require a bearer token, and its
/// response carries the deploy's canonical `audience` URL — verifying it confirms:
///
///   1. the URL points at a CornerTasks backend (response has `challenge` + `audience`),
///   2. the deploy's canonical audience matches what the user typed (the most common
///      BYO-AWS misconfig manifests as `audience != ApiUrl`, which the auth-token
///      step then rejects with `bad_audience`).
///
/// The challenge issued here is discarded — issuing one without exchanging it for a
/// token is harmless and lets the server cleanly TTL it out.
enum BackendPing {
    /// Test seam: returns the URL we'd POST to for a given `apiUrl`. `pingURL` (now
    /// `pullURL` semantically) was the iteration-9 name; kept here so the existing
    /// unit tests still cover URL canonicalisation.
    static func pingURL(apiUrl: String) -> URL? {
        let trimmed = apiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let stripped = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        guard !stripped.isEmpty else { return nil }
        return URL(string: stripped + "/v1/auth/challenge")
    }

    static func ping(apiUrl: String, accountDid: String, session: URLSession = .shared) async throws {
        guard let url = pingURL(apiUrl: apiUrl) else { throw BackendPingError.invalidURL }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["accountDid": accountDid])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw BackendPingError.transport(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw BackendPingError.unexpectedResponse
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (200..<300).contains(http.statusCode) else {
            let reason = json?["reason"] as? String
            throw BackendPingError.http(http.statusCode, reason: reason)
        }
        guard let json,
              let _ = json["challenge"] as? String,
              let audience = json["audience"] as? String else {
            throw BackendPingError.unexpectedResponse
        }
        let expected = canonicalise(apiUrl)
        let got = canonicalise(audience)
        if expected != got {
            throw BackendPingError.audienceMismatch(expected: expected, got: got)
        }
    }

    private static func canonicalise(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let stripped = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        return stripped.lowercased()
    }
}
