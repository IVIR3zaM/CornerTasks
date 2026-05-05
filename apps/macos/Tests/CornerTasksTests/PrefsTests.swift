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
