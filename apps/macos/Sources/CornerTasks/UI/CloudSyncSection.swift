import SwiftUI

/// Account / Cloud-sync block shown inside the Settings panel.
/// Standalone-by-default: cloud sync stays off until the user explicitly enables it.
struct CloudSyncSection: View {
    @ObservedObject var account: AccountManager

    @State private var cloudSyncEnabled: Bool = Prefs.cloudSyncEnabled
    @State private var backendURL: String = Prefs.backendURL ?? ""
    @State private var showEnableSheet = false
    @State private var showMnemonic = false
    @State private var showQR = false
    @State private var pingState: PingState = .idle
    @State private var confirmForget = false
    @State private var syncInterval: SyncIntervalChoice = SyncIntervalChoice.fromSeconds(Prefs.syncIntervalSeconds)
    @State private var syncIntervalAmount: Int = SyncIntervalChoice.amount(forSeconds: Prefs.syncIntervalSeconds)
    @State private var diagLogEnabled: Bool = Prefs.diagLogEnabled
    @State private var diagLogIncludePlaintext: Bool = Prefs.diagLogIncludePlaintext
    /// Debounces rapid stepper / picker changes — without it, every click would
    /// post `cornerTasksSyncIntervalChanged` immediately, and a fast clicker
    /// could fire several reschedules per second.
    @State private var intervalCommitItem: DispatchWorkItem?

    enum PingState: Equatable {
        case idle, pinging, ok, failed(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(cloudSyncEnabled ? "Cloud Sync — On" : "Cloud Sync — Off")
                .font(.subheadline.weight(.semibold))

            if cloudSyncEnabled, account.hasKey {
                enabledBody
            } else {
                disabledBody
            }

            if account.hasKey {
                Divider()
                accountSection
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.primary.opacity(0.06))
        )
        .sheet(isPresented: $showEnableSheet) {
            EnableCloudSyncSheet(account: account, isPresented: $showEnableSheet) { url in
                backendURL = url
                cloudSyncEnabled = true
                Prefs.cloudSyncEnabled = true
                Prefs.backendURL = url
                // Every enable — first time or re-enable — schedules a one-shot
                // full resync. The engine consumes (and clears) the flag on start.
                Prefs.pendingFullResync = true
                NotificationCenter.default.post(name: .cornerTasksCloudSyncChanged, object: nil)
            }
        }
    }

    // MARK: - Disabled state

    private var disabledBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cloud sync is off. Your tasks stay on this Mac.")
                .font(.callout)

            Text("You can stay offline forever. If you decide to enable later, you can either generate a new key (a brand new account) or import an existing key from another device (this Mac will join that account and merge its tasks with the existing ones).")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                showEnableSheet = true
            } label: {
                Text("Enable cloud sync")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
    }

    // MARK: - Enabled state

    private var enabledBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tasks on this Mac will sync to the backend you configured. The full sync engine activates in a later iteration.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                Text("Backend URL").font(.caption.weight(.semibold))
                Spacer()
                if case .ok = pingState {
                    Label("reachable", systemImage: "checkmark.circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
            TextField("https://…execute-api…amazonaws.com/Prod", text: $backendURL)
                .textFieldStyle(.roundedBorder)
                .font(.caption.monospaced())
                .onSubmit { Prefs.backendURL = backendURL }

            HStack(spacing: 8) {
                Button("Test") { Task { await runPing() } }
                    .controlSize(.small)
                    .disabled(backendURL.trimmingCharacters(in: .whitespaces).isEmpty || pingState == .pinging)

                Button("Save") {
                    Prefs.backendURL = backendURL
                }
                .controlSize(.small)

                if case .pinging = pingState {
                    ProgressView().controlSize(.small)
                }
            }

            if case .failed(let msg) = pingState {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()
            Text("Sync every").font(.caption.weight(.semibold))
            HStack(spacing: 6) {
                Stepper(value: $syncIntervalAmount,
                        in: syncInterval.range,
                        step: 1) {
                    Text("\(syncIntervalAmount)").frame(minWidth: 32, alignment: .leading)
                }
                .controlSize(.small)
                .onChange(of: syncIntervalAmount) { _ in commitSyncInterval() }

                Picker("", selection: $syncInterval) {
                    ForEach(SyncIntervalChoice.all, id: \.self) { c in
                        Text(c.label).tag(c)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
                .onChange(of: syncInterval) { new in
                    syncIntervalAmount = max(new.range.lowerBound, min(new.range.upperBound, syncIntervalAmount))
                    commitSyncInterval()
                }
            }
            Text("Range: 10 s – 24 h. Applies to both push and pull.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Disable cloud sync") {
                cloudSyncEnabled = false
                Prefs.cloudSyncEnabled = false
                pingState = .idle
                NotificationCenter.default.post(name: .cornerTasksCloudSyncChanged, object: nil)
            }
            .controlSize(.small)

            Divider()
            diagnosticsSection
        }
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Diagnostics").font(.caption.weight(.semibold))

            Toggle("Log sync activity to file", isOn: $diagLogEnabled)
                .toggleStyle(.switch)
                .controlSize(.small)
                .onChange(of: diagLogEnabled) { Prefs.diagLogEnabled = $0 }

            Text("Writes one JSON line per sync event to sync-log.jsonl in this app's support folder. Bearer tokens, ciphertext, and the mnemonic are never written.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if diagLogEnabled {
                Toggle("Include decrypted task fields (sensitive)", isOn: $diagLogIncludePlaintext)
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .onChange(of: diagLogIncludePlaintext) { Prefs.diagLogIncludePlaintext = $0 }
                if diagLogIncludePlaintext {
                    Text("Task titles and due dates will appear in cleartext. Don't share this log.")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Button("Reveal log") {
                        NSWorkspace.shared.activateFileViewerSelecting([DiagLog.fileURL])
                    }
                    .controlSize(.small)
                    Button("Clear log") {
                        Task { await DiagLog.shared.clear() }
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    // MARK: - Account section (always shown when a key exists)

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Account").font(.subheadline.weight(.semibold))

            if let did = account.did {
                Text("DID").font(.caption.weight(.semibold))
                Text(did)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06))
                    )
            }

            HStack(spacing: 4) {
                Text("Device ID").font(.caption.weight(.semibold))
                Text("debug")
                    .font(.system(size: 9, weight: .semibold))
                    .padding(.horizontal, 4)
                    .background(Color.primary.opacity(0.08))
                    .foregroundStyle(.secondary)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            Text(Prefs.deviceId)
                .font(.system(size: 10).monospaced())
                .foregroundStyle(.secondary)
                .opacity(0.7)
                .textSelection(.enabled)
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04))
                )

            DisclosureGroup(isExpanded: Binding(
                get: { showMnemonic },
                set: { newValue in
                    if newValue {
                        // Two-step gate: device-owner auth first, then load + display.
                        // Without this, a bystander on an unlocked Mac could expand
                        // the disclosure and read the mnemonic with no friction
                        // (the keychain "Always Allow" suppresses the system prompt).
                        Task { @MainActor in
                            let ok = await RevealGate.require(reason: "Reveal your CornerTasks mnemonic.")
                            guard ok else { return }
                            account.loadIfPresent()
                            showMnemonic = true
                        }
                    } else {
                        showMnemonic = false
                    }
                }
            )) {
                if showMnemonic, let m = account.mnemonic {
                    Text("Treat these 12 words like a password. Anyone with them can read and modify this account's tasks.")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(m)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06))
                        )
                }
            } label: {
                Text("Show mnemonic").font(.caption)
            }

            DisclosureGroup(isExpanded: Binding(
                get: { showQR },
                set: { newValue in
                    if newValue {
                        // Same gate as Show mnemonic — the QR encodes the same secret.
                        Task { @MainActor in
                            let ok = await RevealGate.require(reason: "Reveal your CornerTasks recovery QR code.")
                            guard ok else { return }
                            account.loadIfPresent()
                            showQR = true
                        }
                    } else {
                        showQR = false
                    }
                }
            )) {
                if showQR, let m = account.mnemonic {
                    Text("This QR code encodes the same 12 words as your mnemonic. Treat it like a password — anyone who scans it can read and modify this account's tasks.")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    QRCodeView(payload: m)
                        .padding(.top, 4)
                    Text("Scan this with the web app on another device to import this account.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } label: {
                Text("Show QR code").font(.caption)
            }

            if confirmForget {
                VStack(alignment: .leading, spacing: 6) {
                    Text("This wipes the mnemonic from your Keychain. Tasks on this Mac are kept; cloud sync turns off. If you have not backed up the 12 words, you cannot recover this account.")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("Forget anyway", role: .destructive) {
                            try? account.forget()
                            cloudSyncEnabled = false
                            Prefs.cloudSyncEnabled = false
                            confirmForget = false
                            showMnemonic = false
                            showQR = false
                        }
                        .controlSize(.small)
                        Button("Cancel") { confirmForget = false }
                            .controlSize(.small)
                    }
                }
            } else {
                Button("Forget this device") { confirmForget = true }
                    .controlSize(.small)
            }
        }
    }

    private func commitSyncInterval() {
        intervalCommitItem?.cancel()
        let seconds = syncInterval.toSeconds(amount: syncIntervalAmount)
        let clamped = max(Prefs.syncIntervalMinSeconds, min(Prefs.syncIntervalMaxSeconds, seconds))
        let item = DispatchWorkItem {
            guard clamped != Prefs.syncIntervalSeconds else { return }
            Prefs.syncIntervalSeconds = clamped
            // Lightweight signal — the engine reschedules its timers and keeps
            // its bearer + AuthSession. Avoids the challenge+token+pull burst
            // that a full restart would cause on every commit.
            NotificationCenter.default.post(name: .cornerTasksSyncIntervalChanged, object: nil)
        }
        intervalCommitItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
    }

    private func runPing() async {
        guard let did = account.did else { return }
        pingState = .pinging
        do {
            try await BackendPing.ping(apiUrl: backendURL, accountDid: did)
            pingState = .ok
            Prefs.backendURL = backendURL
        } catch {
            pingState = .failed(Self.describe(error))
        }
    }

    /// Three-segment picker: seconds / minutes / hours. The Stepper's range adjusts
    /// to match each unit so the user can't dial outside the supported window.
    enum SyncIntervalChoice: Hashable {
        case seconds, minutes, hours
        static let all: [SyncIntervalChoice] = [.seconds, .minutes, .hours]
        var label: String {
            switch self { case .seconds: return "sec"; case .minutes: return "min"; case .hours: return "hr" }
        }
        var range: ClosedRange<Int> {
            switch self {
            case .seconds: return 10...59
            case .minutes: return 1...59
            case .hours:   return 1...24
            }
        }
        func toSeconds(amount: Int) -> Int {
            switch self {
            case .seconds: return amount
            case .minutes: return amount * 60
            case .hours:   return amount * 3600
            }
        }
        static func fromSeconds(_ s: Int) -> SyncIntervalChoice {
            if s >= 3600 && s % 3600 == 0 { return .hours }
            if s >= 60 && s % 60 == 0 { return .minutes }
            return .seconds
        }
        static func amount(forSeconds s: Int) -> Int {
            switch fromSeconds(s) {
            case .seconds: return max(10, min(59, s))
            case .minutes: return max(1, min(59, s / 60))
            case .hours:   return max(1, min(24, s / 3600))
            }
        }
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case BackendPingError.invalidURL:
            return "URL looks malformed."
        case BackendPingError.http(let status, let reason):
            if let reason { return "Server replied HTTP \(status) (\(reason))." }
            return "Server replied HTTP \(status)."
        case BackendPingError.unexpectedResponse:
            return "Reachable, but the response did not look like a CornerTasks backend."
        case BackendPingError.audienceMismatch(let expected, let got):
            return "URL mismatch: this deploy's canonical audience is \(got), but you typed \(expected). Use the canonical URL or the auth-token step will reject your DID-JWT."
        case BackendPingError.transport(let m):
            return "Could not reach the URL: \(m)"
        default:
            return "Failed: \(error)"
        }
    }
}
