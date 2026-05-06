import Foundation

enum BackendPingError: Error, Equatable {
    case invalidURL
    case http(Int)
    case unexpectedResponse
    case transport(String)
}

/// Validates a user-supplied `ApiUrl` by hitting `/v1/sync/pull` with a far-future `since`.
/// The expected response is a JSON object containing an `events` array and a `serverTime` field
/// (per `docs/sync-protocol.md`). The actual sync engine, including DID-Auth, lands later;
/// for the iteration-9 enable flow this is a lightweight reachability + shape check.
enum BackendPing {
    static func pingURL(apiUrl: String, accountDid: String) -> URL? {
        let trimmed = apiUrl
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let stripped = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        guard !stripped.isEmpty else { return nil }
        guard var comps = URLComponents(string: stripped + "/v1/sync/pull") else { return nil }
        comps.queryItems = [
            URLQueryItem(name: "accountDid", value: accountDid),
            URLQueryItem(name: "since", value: "2099-01-01T00:00:00Z")
        ]
        return comps.url
    }

    static func ping(apiUrl: String, accountDid: String, session: URLSession = .shared) async throws {
        guard let url = pingURL(apiUrl: apiUrl, accountDid: accountDid) else {
            throw BackendPingError.invalidURL
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw BackendPingError.transport(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw BackendPingError.unexpectedResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BackendPingError.http(http.statusCode)
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["events"] is [Any],
              json["serverTime"] != nil else {
            throw BackendPingError.unexpectedResponse
        }
    }
}
