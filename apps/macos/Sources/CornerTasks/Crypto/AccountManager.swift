import Foundation

protocol MnemonicProvider {
    func save(_ mnemonic: String) throws
    func load() throws -> String?
    func clear() throws
}

struct KeychainMnemonicProvider: MnemonicProvider {
    func save(_ mnemonic: String) throws { try MnemonicStore.save(mnemonic) }
    func load() throws -> String? { try MnemonicStore.load() }
    func clear() throws { try MnemonicStore.clear() }
}

enum AccountError: Error, Equatable {
    case invalidMnemonic
}

/// Holds the user's BIP-39 mnemonic and derived DID. Exposes `did` for UI binding;
/// the mnemonic is kept in memory only after a generate / import / load and is the
/// source for "Show mnemonic" / "Show QR code" reveals.
///
/// The Keychain is **not** queried on construction — opening the macOS app while
/// cloud sync is off must not produce a Keychain authorisation prompt. Callers must
/// invoke `loadIfPresent()` explicitly when the user has signalled intent to see
/// account info (opening Settings, expanding "Show mnemonic" / "Show QR code", or
/// the sync engine starting up). `loadIfPresent` is idempotent.
final class AccountManager: ObservableObject {
    @Published private(set) var did: String?
    private(set) var identity: Identity?
    private(set) var mnemonic: String?

    private let store: MnemonicProvider

    init(store: MnemonicProvider = KeychainMnemonicProvider()) {
        self.store = store
    }

    var hasKey: Bool { identity != nil }

    /// Reads the mnemonic from the configured store and populates `did`/`identity`/
    /// `mnemonic` if one is present. No-op once a mnemonic has already been loaded
    /// in this process — the Keychain is queried at most once per session per manager.
    func loadIfPresent() {
        if mnemonic != nil { return }
        guard let m = try? store.load(), Mnemonic.validate(m) else { return }
        applyMnemonic(m)
    }

    @discardableResult
    func generateNew() throws -> String {
        let m = try Mnemonic.generate()
        try store.save(m)
        applyMnemonic(m)
        return m
    }

    @discardableResult
    func importMnemonic(_ raw: String) throws -> String {
        let normalised = Self.normalise(raw)
        guard Mnemonic.validate(normalised) else { throw AccountError.invalidMnemonic }
        try store.save(normalised)
        applyMnemonic(normalised)
        return normalised
    }

    func forget() throws {
        try store.clear()
        mnemonic = nil
        identity = nil
        did = nil
    }

    static func normalise(_ raw: String) -> String {
        raw.lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private func applyMnemonic(_ m: String) {
        let seed = Mnemonic.toSeed(m)
        guard let id = try? Identity.fromBip39Seed(seed) else { return }
        mnemonic = m
        identity = id
        did = id.accountDid
    }
}
