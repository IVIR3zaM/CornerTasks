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

            Button("Disable cloud sync") {
                cloudSyncEnabled = false
                Prefs.cloudSyncEnabled = false
                pingState = .idle
            }
            .controlSize(.small)
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

            DisclosureGroup(isExpanded: $showMnemonic) {
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

            DisclosureGroup(isExpanded: $showQR) {
                if showQR, let m = account.mnemonic {
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

    static func describe(_ error: Error) -> String {
        switch error {
        case BackendPingError.invalidURL: return "URL looks malformed."
        case BackendPingError.http(let s): return "Server replied HTTP \(s)."
        case BackendPingError.unexpectedResponse: return "Reachable, but the response did not look like a CornerTasks backend."
        case BackendPingError.transport(let m): return "Could not reach the URL: \(m)"
        default: return "Failed: \(error)"
        }
    }
}
