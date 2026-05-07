import Foundation
import Security

enum MnemonicStoreError: Error {
    case unexpectedStatus(OSStatus)
    case dataCorrupted
}

/// macOS Keychain wrapper for the user's BIP-39 mnemonic.
/// Service: `com.cornertasks.mnemonic`. Account: a fixed string — there is at most one mnemonic per app.
enum MnemonicStore {
    static let service = "com.cornertasks.mnemonic"
    static let account = "default"

    static func save(_ mnemonic: String) throws {
        let data = Data(mnemonic.utf8)
        // Try update first; if nothing to update, add.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            // Pin accessibility: only readable while the device is unlocked, AND
            // never copied to iCloud Keychain or restored to a different device.
            // The mnemonic must stay where it was provisioned — users that want it
            // on another device transfer it explicitly via QR / paste.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw MnemonicStoreError.unexpectedStatus(updateStatus)
        }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw MnemonicStoreError.unexpectedStatus(addStatus)
        }
    }

    static func load() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        if status != errSecSuccess { throw MnemonicStoreError.unexpectedStatus(status) }
        guard let data = item as? Data, let s = String(data: data, encoding: .utf8) else {
            throw MnemonicStoreError.dataCorrupted
        }
        return s
    }

    static func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw MnemonicStoreError.unexpectedStatus(status)
        }
    }
}
