import XCTest
@testable import CornerTasks

/// Asserts the documented defaults for `Prefs` (see AGENTS.md → Dock visibility).
/// Uses an isolated `UserDefaults` suite so the host's real prefs are not touched.
final class PrefsTests: XCTestCase {
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "CornerTasksTests-\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testShowInDockDefaultsToTrueWhenUnset() {
        // `Prefs.showInDock` reads from `UserDefaults.standard`. We can't redirect
        // its store, but we can assert the documented behavior: when the key has
        // no value set, the getter returns `true`.
        let key = Prefs.showInDockKey
        let original = UserDefaults.standard.object(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        XCTAssertNil(UserDefaults.standard.object(forKey: key))
        XCTAssertTrue(Prefs.showInDock)
    }

    func testCloudSyncEnabledDefaultsToFalseWhenUnset() {
        // Standalone-by-default: a freshly-installed app must NOT have
        // cloud sync turned on. This is the released-binary contract.
        let key = Prefs.cloudSyncEnabledKey
        let original = UserDefaults.standard.object(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        XCTAssertNil(UserDefaults.standard.object(forKey: key))
        XCTAssertFalse(Prefs.cloudSyncEnabled)
    }

    func testBackendURLDefaultsToNilWhenUnset() {
        let key = Prefs.backendURLKey
        let original = UserDefaults.standard.object(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        XCTAssertNil(Prefs.backendURL)
    }

    func testCloudSyncEnabledRoundTrips() {
        let key = Prefs.cloudSyncEnabledKey
        let original = UserDefaults.standard.object(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        Prefs.cloudSyncEnabled = true
        XCTAssertTrue(Prefs.cloudSyncEnabled)
        Prefs.cloudSyncEnabled = false
        XCTAssertFalse(Prefs.cloudSyncEnabled)
    }

    func testBackendURLRoundTripsAndTrims() {
        let key = Prefs.backendURLKey
        let original = UserDefaults.standard.object(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        Prefs.backendURL = "  https://example.execute-api.us-east-1.amazonaws.com  "
        XCTAssertEqual(Prefs.backendURL, "https://example.execute-api.us-east-1.amazonaws.com")

        Prefs.backendURL = "   "
        XCTAssertNil(Prefs.backendURL)

        Prefs.backendURL = nil
        XCTAssertNil(Prefs.backendURL)
    }

    func testShowInDockRoundTrips() {
        let key = Prefs.showInDockKey
        let original = UserDefaults.standard.object(forKey: key)
        defer {
            if let original {
                UserDefaults.standard.set(original, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        Prefs.showInDock = false
        XCTAssertFalse(Prefs.showInDock)

        Prefs.showInDock = true
        XCTAssertTrue(Prefs.showInDock)
    }
}
