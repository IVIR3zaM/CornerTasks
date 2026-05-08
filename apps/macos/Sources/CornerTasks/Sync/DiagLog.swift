import AppKit
import Foundation

/// Opt-in JSON-line diagnostic log for the sync engine. Writes to
/// `~/Library/Application Support/CornerTasks/sync-log.jsonl`, rotating to
/// `sync-log.jsonl.1` at `maxFileBytes`.
///
/// Hot path: every call site reads `Prefs.diagLogEnabled` first and skips the
/// actor hop entirely when off, so the engine pays nothing in the default-off
/// configuration.
///
/// Redaction is the responsibility of the *caller*. This actor will not see
/// raw bearer tokens, DID-JWTs, ciphertext, or the mnemonic — call sites pass
/// in pre-redacted summaries (lengths, hashes, counts). The one optional leak
/// is decrypted task fields, behind the separate `diagLogIncludePlaintext`
/// pref and the `plaintext` parameter on `record(...)`.
actor DiagLog {
    static let shared = DiagLog()

    private let maxFileBytes: Int = 5 * 1024 * 1024  // 5 MB

    private init() {}

    static var fileURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = appSupport.appendingPathComponent("CornerTasks", isDirectory: true)
        return folder.appendingPathComponent("sync-log.jsonl", isDirectory: false)
    }

    private var rotatedURL: URL { Self.fileURL.appendingPathExtension("1") }

    /// One-line append. `fields` is merged on top of the standard envelope
    /// (`ts`, `event`). If `Prefs.diagLogEnabled` is false this is a no-op.
    nonisolated func record(_ event: String, _ fields: [String: Any] = [:]) {
        guard Prefs.diagLogEnabled else { return }
        let ts = ISO8601DateFormatter.shared.string(from: Date())
        Task.detached(priority: .utility) { [weak self] in
            await self?.write(event: event, ts: ts, fields: fields)
        }
    }

    /// Synchronous flush + clear. Used by the "Clear log" button.
    func clear() {
        try? FileManager.default.removeItem(at: Self.fileURL)
        try? FileManager.default.removeItem(at: rotatedURL)
    }

    private func write(event: String, ts: String, fields: [String: Any]) {
        var payload: [String: Any] = ["ts": ts, "event": event]
        for (k, v) in fields { payload[k] = v }

        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            return
        }
        var line = data
        line.append(0x0A)  // newline

        let url = Self.fileURL
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        rotateIfNeeded(adding: line.count, at: url)

        if FileManager.default.fileExists(atPath: url.path) {
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: line)
            }
        } else {
            try? line.write(to: url, options: .atomic)
        }
    }

    private func rotateIfNeeded(adding incomingBytes: Int, at url: URL) {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        guard size + incomingBytes > maxFileBytes else { return }

        try? FileManager.default.removeItem(at: rotatedURL)
        try? FileManager.default.moveItem(at: url, to: rotatedURL)
    }
}

extension ISO8601DateFormatter {
    static let shared: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
