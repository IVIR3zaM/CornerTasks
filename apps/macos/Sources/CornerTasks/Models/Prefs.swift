import AppKit
import Foundation

enum Prefs {
    static let showInDockKey = "showInDock"
    static let cloudSyncEnabledKey = "cloudSyncEnabled"
    static let backendURLKey = "backendURL"

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
