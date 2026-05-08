import AppKit
import Foundation

extension Notification.Name {
    /// Posted whenever `Prefs.cloudSyncEnabled` or `Prefs.backendURL` is mutated by
    /// the UI. `AppDelegate` observes this to start or stop the sync engine in-process
    /// (no app restart required).
    static let cornerTasksCloudSyncChanged = Notification.Name("CornerTasks.cloudSyncChanged")
}

enum Prefs {
    static let showInDockKey = "showInDock"
    static let cloudSyncEnabledKey = "cloudSyncEnabled"
    static let backendURLKey = "backendURL"
    static let deviceIdKey = "cornertasks.sync.deviceId"
    static let syncIntervalSecondsKey = "cornertasks.sync.intervalSeconds"
    static let pendingFullResyncKey = "cornertasks.sync.pendingFullResync"

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
