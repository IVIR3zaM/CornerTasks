import SwiftUI

/// Modal shown when the user clicks "Enable cloud sync". Two branches:
///   1. Generate new key — fresh mnemonic + DID, requires backup acknowledgement.
///   2. Import from mnemonic — paste 12 words, BIP-39 checksum-validated, with a
///      prominent merge warning (wording matches the web app per AGENTS.md).
struct EnableCloudSyncSheet: View {
    @ObservedObject var account: AccountManager
    @Binding var isPresented: Bool
    var onEnabled: (String) -> Void

    enum Step {
        case chooser, generated, importing
    }

    @State private var step: Step = .chooser
    @State private var generatedMnemonic = ""
    @State private var backedUp = false
    @State private var importInput = ""
    @State private var importError: String?
    @State private var apiUrl = Prefs.backendURL ?? ""
    @State private var mergeAcknowledged = false
    @State private var ready = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            Divider()

            switch step {
            case .chooser: chooser
            case .generated: generated
            case .importing: importView
            }

            if step != .chooser {
                Divider()
                backendField
                Spacer(minLength: 0)
                HStack {
                    Button("Cancel") { isPresented = false }
                    Spacer()
                    Button("Enable cloud sync") { commit() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canCommit)
                }
            }
        }
        .padding(20)
        .frame(width: 460, height: step == .chooser ? 260 : 540)
    }

    private var title: String {
        switch step {
        case .chooser: return "Enable cloud sync"
        case .generated: return "Your new account"
        case .importing: return "Import existing account"
        }
    }

    // MARK: - Chooser

    private var chooser: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pick how this Mac joins an account.")
                .font(.callout)

            Button {
                generateNewKey()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Generate new key").font(.body.weight(.semibold))
                    Text("Creates a brand-new account. You'll see 12 words to back up — they are the only way to recover this account.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
            }
            .buttonStyle(.bordered)

            Button {
                step = .importing
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Import from mnemonic").font(.body.weight(.semibold))
                    Text("Paste the 12 words from another device. This Mac will join that account. Tasks already on this Mac will be merged with the account's tasks.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
            }
            .buttonStyle(.bordered)

            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Cancel") { isPresented = false }
            }
        }
    }

    // MARK: - Generated branch

    private var generated: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Write these 12 words down somewhere safe. They are the only way to recover this account.")
                .font(.callout)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)

            Text(generatedMnemonic)
                .font(.body.monospaced())
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.06))
                )

            if let did = account.did {
                Text("DID").font(.caption.weight(.semibold))
                Text(did)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }

            Toggle("I have backed up these words", isOn: $backedUp)
                .toggleStyle(.checkbox)
        }
    }

    // MARK: - Import branch

    private var importView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("If this key already controls another account on the cloud, the tasks on this Mac will be merged with that account's tasks. This cannot be undone.")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.white)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10).fill(Color.red)
                )
                .fixedSize(horizontal: false, vertical: true)

            Text("Paste your 12-word mnemonic.")
                .font(.callout)

            TextEditor(text: $importInput)
                .font(.body.monospaced())
                .frame(height: 80)
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06))
                )

            if let err = importError {
                Text(err).font(.caption).foregroundStyle(.red)
            } else if let did = account.did {
                Text("DID: \(did)").font(.caption.monospaced()).foregroundStyle(.secondary)
            }

            HStack {
                Button("Validate") { validateImport() }
                    .controlSize(.small)
                Spacer()
            }

            Toggle("I understand my local tasks will be merged into this account.", isOn: $mergeAcknowledged)
                .toggleStyle(.checkbox)
                .font(.caption)
        }
    }

    // MARK: - Backend URL

    private var backendField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Backend URL").font(.caption.weight(.semibold))
            TextField("https://…execute-api…amazonaws.com/Prod", text: $apiUrl)
                .textFieldStyle(.roundedBorder)
                .font(.caption.monospaced())
            Text("Paste the ApiUrl from your own backend deployment (see backend/aws/README.md).")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Actions

    private var canCommit: Bool {
        guard account.hasKey, !apiUrl.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        switch step {
        case .generated: return backedUp
        case .importing: return mergeAcknowledged
        case .chooser: return false
        }
    }

    private func generateNewKey() {
        do {
            generatedMnemonic = try account.generateNew()
            step = .generated
        } catch {
            importError = "Could not generate a key: \(error)"
        }
    }

    private func validateImport() {
        importError = nil
        do {
            _ = try account.importMnemonic(importInput)
        } catch AccountError.invalidMnemonic {
            importError = "That doesn't look like a valid 12-word BIP-39 mnemonic."
        } catch {
            importError = "Could not import: \(error)"
        }
    }

    private func commit() {
        let trimmed = apiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onEnabled(trimmed)
        isPresented = false
    }
}
