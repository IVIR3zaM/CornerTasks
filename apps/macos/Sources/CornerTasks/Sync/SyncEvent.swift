import CryptoKit
import Foundation

/// One mutation in transit per `docs/sync-protocol.md` §3. Cleartext fields plus the
/// AES-256-GCM ciphertext+nonce of the encrypted payload.
struct SyncEvent: Codable, Equatable {
    let accountDid: String
    let deviceId: String
    let eventId: String
    let taskId: String
    let updatedAt: String
    let op: String
    let ciphertext: String
    let nonce: String
}

/// Plaintext payload encrypted into `SyncEvent.ciphertext` for `op="upsert"`.
struct EventPlaintext: Equatable {
    var title: String
    var createdAt: Date
    var completedAt: Date?
    var dueDate: Date?
    var order: Int
}

enum SyncEventCodec {
    /// `JSON.stringify` with the fixed key order specified by `docs/sync-protocol.md` §4
    /// (title, createdAt, completedAt, dueDate, order). Hand-built so encoder ordering is
    /// independent of dictionary iteration.
    static func encodePlaintext(_ pt: EventPlaintext) -> Data {
        var s = "{"
        s += "\"title\":" + jsonString(pt.title) + ","
        s += "\"createdAt\":" + jsonString(ISO8601.format(pt.createdAt)) + ","
        s += "\"completedAt\":"
        if let c = pt.completedAt { s += jsonString(ISO8601.format(c)) } else { s += "null" }
        s += ","
        s += "\"dueDate\":"
        if let d = pt.dueDate { s += jsonString(ISO8601.format(d)) } else { s += "null" }
        s += ","
        s += "\"order\":\(pt.order)"
        s += "}"
        return Data(s.utf8)
    }

    static func decodePlaintext(_ data: Data) -> EventPlaintext? {
        guard let any = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let title = any["title"] as? String else { return nil }
        guard let createdStr = any["createdAt"] as? String, let createdAt = ISO8601.parse(createdStr) else { return nil }
        var completedAt: Date? = nil
        if let s = any["completedAt"] as? String { completedAt = ISO8601.parse(s) }
        var dueDate: Date? = nil
        if let s = any["dueDate"] as? String { dueDate = ISO8601.parse(s) }
        let order = (any["order"] as? Int) ?? Int((any["order"] as? NSNumber)?.intValue ?? 0)
        return EventPlaintext(title: title, createdAt: createdAt, completedAt: completedAt, dueDate: dueDate, order: order)
    }

    static func aad(accountDid: String, taskId: String, eventId: String) -> Data {
        Data("\(accountDid)|\(taskId)|\(eventId)".utf8)
    }

    /// Build and seal an upsert/delete event for the given task snapshot. The plaintext
    /// for delete events is `{}` per §3.
    static func makeEvent(
        op: String,
        accountDid: String,
        deviceId: String,
        eventId: String = UUID().uuidString.lowercased(),
        taskId: String,
        updatedAt: Date,
        plaintext: EventPlaintext?,
        encryptionKey: SymmetricKey,
        nonce: Data? = nil
    ) throws -> SyncEvent {
        let pt: Data
        if op == "delete" {
            pt = Data("{}".utf8)
        } else if let plaintext {
            pt = encodePlaintext(plaintext)
        } else {
            pt = Data("{}".utf8)
        }
        let aad = aad(accountDid: accountDid, taskId: taskId, eventId: eventId)
        let (ct, n) = try SymmetricBox.seal(plaintext: pt, key: encryptionKey, aad: aad, nonce: nonce)
        return SyncEvent(
            accountDid: accountDid,
            deviceId: deviceId,
            eventId: eventId,
            taskId: taskId,
            updatedAt: ISO8601.format(updatedAt),
            op: op,
            ciphertext: Base64Url.encode(ct),
            nonce: Base64Url.encode(n)
        )
    }

    /// Verifies the AAD, decrypts the ciphertext, and (for upsert events) returns the
    /// decoded plaintext. Returns nil for `op="delete"`.
    static func openEvent(_ event: SyncEvent, encryptionKey: SymmetricKey) throws -> EventPlaintext? {
        guard let ct = Base64Url.decode(event.ciphertext), let nonce = Base64Url.decode(event.nonce) else {
            throw SymmetricBoxError.invalidCiphertext
        }
        let aad = aad(accountDid: event.accountDid, taskId: event.taskId, eventId: event.eventId)
        let pt = try SymmetricBox.open(ciphertext: ct, nonce: nonce, key: encryptionKey, aad: aad)
        if event.op == "delete" { return nil }
        return decodePlaintext(pt)
    }

    private static func jsonString(_ s: String) -> String {
        // Escape exactly what the JSON RFC requires; dueDate/createdAt are already
        // ASCII ISO 8601 so the typical hot path is just quotes + the input.
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out.append("\\\"")
            case "\\": out.append("\\\\")
            case "\u{08}": out.append("\\b")
            case "\u{0C}": out.append("\\f")
            case "\n": out.append("\\n")
            case "\r": out.append("\\r")
            case "\t": out.append("\\t")
            case _ where scalar.value < 0x20:
                out.append(String(format: "\\u%04x", scalar.value))
            default:
                out.append(Character(scalar))
            }
        }
        out.append("\"")
        return out
    }
}

enum ISO8601 {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let formatterNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func format(_ date: Date) -> String {
        formatter.string(from: date)
    }

    static func parse(_ s: String) -> Date? {
        formatter.date(from: s) ?? formatterNoFraction.date(from: s)
    }
}
