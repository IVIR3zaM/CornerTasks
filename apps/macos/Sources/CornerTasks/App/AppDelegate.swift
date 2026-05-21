import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: NSPanel?
    private var statusItem: NSStatusItem?
    private let store = TaskStore()
    private var syncEngine: SyncEngine?

    func applicationDidFinishLaunching(_ notification: Notification) {
        applyActivationPolicy()
        setupStatusItem()
        showPanel()
        startSyncIfEnabled()
        // The settings UI flips Prefs.cloudSyncEnabled at runtime; observe the change
        // so we start/stop the engine without requiring an app restart.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleCloudSyncChanged),
            name: .cornerTasksCloudSyncChanged,
            object: nil
        )
        // Distinct lightweight notification: just rearm the timers, no engine
        // recreate. Without this, every stepper click would teardown the
        // engine, drop the cached bearer, and burst challenge+token+pull.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleSyncIntervalChanged),
            name: .cornerTasksSyncIntervalChanged,
            object: nil
        )
    }

    @objc private func handleCloudSyncChanged() {
        startSyncIfEnabled()
    }

    @objc private func handleSyncIntervalChanged() {
        syncEngine?.reschedule()
    }

    /// Starts the sync engine iff cloud sync is enabled, a backend URL is configured,
    /// and a key (mnemonic + identity) is in the Keychain. Otherwise the app stays
    /// fully offline — no enqueuer, no timers, no network.
    ///
    /// The Keychain is queried only on this branch — when cloud sync is off the user
    /// sees no authorisation prompt at launch.
    func startSyncIfEnabled() {
        syncEngine?.stop()
        syncEngine = nil

        guard Prefs.cloudSyncEnabled, let apiUrl = Prefs.backendURL else { return }
        let account = AccountManager()
        account.loadIfPresent()
        guard let identity = account.identity,
              let mnemonic = account.mnemonic,
              let transport = URLSessionSyncTransport(apiUrl: apiUrl) else { return }

        let key = DataKey.encryptionKey(from: Mnemonic.toSeed(mnemonic))
        let engine = SyncEngine(
            store: store,
            transport: transport,
            identity: identity,
            encryptionKey: key,
            deviceId: Prefs.deviceId
        )
        engine.start()
        syncEngine = engine
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPanel()
        return true
    }

    func applyActivationPolicy() {
        NSApp.setActivationPolicy(Prefs.showInDock ? .regular : .accessory)
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "✓"
        item.button?.toolTip = "Corner Tasks"

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show / Hide", action: #selector(togglePanel), keyEquivalent: "t"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Corner Tasks", action: #selector(quit), keyEquivalent: "q"))
        item.menu = menu
        self.statusItem = item
    }

    private func showPanel() {
        if panel == nil {
            let content = ContentView(store: store)
            let hosting = NSHostingController(rootView: content)

            let p = NSPanel(
                contentRect: defaultPanelFrame(),
                styleMask: [.nonactivatingPanel, .titled, .closable, .fullSizeContentView, .resizable],
                backing: .buffered,
                defer: false
            )

            p.title = "Corner Tasks"
            p.isFloatingPanel = true
            p.level = .floating
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            p.hidesOnDeactivate = false
            p.isReleasedWhenClosed = false
            p.titlebarAppearsTransparent = true
            p.titleVisibility = .hidden
            p.standardWindowButton(.miniaturizeButton)?.isHidden = true
            p.standardWindowButton(.zoomButton)?.isHidden = true
            p.appearance = NSAppearance(named: .darkAqua)
            p.contentViewController = hosting
            p.minSize = NSSize(width: 280, height: 200)
            // Don't let macOS persist a smaller frame from a previous session.
            p.setFrameAutosaveName("")

            self.panel = p
        }

        // Always force the right-edge full-height layout on show.
        panel?.setFrame(defaultPanelFrame(), display: true)
        panel?.orderFrontRegardless()
    }

    private func defaultPanelFrame() -> NSRect {
        let width: CGFloat = 360
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSRect(
            x: screenFrame.maxX - width,
            y: screenFrame.minY,
            width: width,
            height: screenFrame.height
        )
    }

    @objc private func togglePanel() {
        guard let panel else {
            showPanel()
            return
        }

        if panel.isVisible {
            panel.orderOut(nil)
        } else {
            showPanel()
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
