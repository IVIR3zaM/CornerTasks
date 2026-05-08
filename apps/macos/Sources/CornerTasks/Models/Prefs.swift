import AppKit
import Foundation

extension Notification.Name {
    /// Posted whenever `Prefs.cloudSyncEnabled` or `Prefs.backendURL` is mutated by
    /// the UI. `AppDelegate` observes this to start or stop the sync engine in-process
    /// (no app restart required).
    static let cornerTasksCloudSyncChanged = Notification.Name("CornerTasks.cloudSyncChanged")

    /// Lightweight signal: only the timer cadence changed. Engine reschedules
    /// timers and keeps its bearer + AuthSession. Distinct from the full
    /// restart triggered by `cornerTasksCloudSyncChanged` (enable, disable,
    /// backend URL change, mnemonic change).
    static let cornerTasksSyncIntervalChanged = Notification.Name("CornerTasks.syncIntervalChanged")
}

enum Prefs {
    static let showInDockKey = "showInDock"
    static let cloudSyncEnabledKey = "cloudSyncEnabled"
    static let backendURLKey = "backendURL"
    static let deviceIdKey = "cornertasks.sync.deviceId"
    static let syncIntervalSecondsKey = "cornertasks.sync.intervalSeconds"
    static let pendingFullResyncKey = "cornertasks.sync.pendingFullResync"
    static let diagLogEnabledKey = "cornertasks.sync.diagLogEnabled"
    static let diagLogIncludePlaintextKey = "cornertasks.sync.diagLogIncludePlaintext"

    /// Allowed range for the user-controlled sync timing.
    static let syncIntervalMinSeconds: Int = 10           // 10 s
    static let syncIntervalMaxSeconds: Int = 24 * 60 * 60 // 24 h
    static let syncIntervalDefaultSeconds: Int = 60       // 1 min

    /// Stable random UUID generated once on first sync. Used as `deviceId` in §3 events.
    static var deviceId: String {
        if let existing = UserDefaults.standard.string(forKey: deviceIdKey), !existing.isEmpty {
            return existing
        }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: deviceIdKey)
        return id
    }

    static var showInDock: Bool {
        get {
            if UserDefaults.standard.object(forKey: showInDockKey) == nil { return true }
            return UserDefaults.standard.bool(forKey: showInDockKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: showInDockKey) }
    }

    // Standalone-by-default: a freshly-installed CornerTasks makes zero
    // network calls. Real enable/disable flow + key management lands in
    // iteration 9; today only the stored preference exists.
    static var cloudSyncEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: cloudSyncEnabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: cloudSyncEnabledKey) }
    }

    /// Single user-controlled timer cadence used for both push and pull. Clamped to
    /// [10 s, 24 h]. Changing it posts `cornerTasksCloudSyncChanged` so the engine
    /// can reschedule its timers without an app restart.
    static var syncIntervalSeconds: Int {
        get {
            let raw = UserDefaults.standard.object(forKey: syncIntervalSecondsKey) as? Int
            let v = raw ?? syncIntervalDefaultSeconds
            return max(syncIntervalMinSeconds, min(syncIntervalMaxSeconds, v))
        }
        set {
            let clamped = max(syncIntervalMinSeconds, min(syncIntervalMaxSeconds, newValue))
            UserDefaults.standard.set(clamped, forKey: syncIntervalSecondsKey)
        }
    }

    /// True between the moment the user clicks "Enable cloud sync" and the moment the
    /// engine has finished its one-shot full resync. Survives a process restart so
    /// the resync runs on next launch if the app was killed mid-flight.
    static var pendingFullResync: Bool {
        get { UserDefaults.standard.bool(forKey: pendingFullResyncKey) }
        set { UserDefaults.standard.set(newValue, forKey: pendingFullResyncKey) }
    }

    /// Off by default. When on, the sync engine writes one JSON line per
    /// significant event to `~/Library/Application Support/CornerTasks/sync-log.jsonl`.
    /// Bearer tokens, DID-JWTs, ciphertext, and the mnemonic are never written.
    static var diagLogEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: diagLogEnabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: diagLogEnabledKey) }
    }

    /// Off by default — opt-in extra. When also true, decrypted task fields
    /// (title, dates) are included in the log. Useful for diagnosing decrypt
    /// drift, dangerous if the log is shared. Has no effect unless
    /// `diagLogEnabled` is also true.
    static var diagLogIncludePlaintext: Bool {
        get { UserDefaults.standard.bool(forKey: diagLogIncludePlaintextKey) }
        set { UserDefaults.standard.set(newValue, forKey: diagLogIncludePlaintextKey) }
    }

    static var backendURL: String? {
        get {
            let raw = UserDefaults.standard.string(forKey: backendURLKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return (raw?.isEmpty == false) ? raw : nil
        }
        set {
            let trimmed = newValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let trimmed, !trimmed.isEmpty {
                UserDefaults.standard.set(trimmed, forKey: backendURLKey)
            } else {
                UserDefaults.standard.removeObject(forKey: backendURLKey)
            }
        }
    }
}
