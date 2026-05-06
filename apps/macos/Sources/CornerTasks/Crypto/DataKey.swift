import CryptoKit
import Foundation

enum DataKey {
    static let identityInfo = Data("cornertasks-identity-ed25519".utf8)
    static let encryptionInfo = Data("cornertasks-encryption-aesgcm".utf8)

    /// HKDF-SHA256(seed, info, 32). Empty salt (RFC 5869 default — 32 zero bytes for SHA-256).
    static func derive(seed: Data, info: Data, length: Int = 32) -> SymmetricKey {
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: seed),
            info: info,
            outputByteCount: length
        )
    }

    static func identitySeed(from bip39Seed: Data) -> Data {
        derive(seed: bip39Seed, info: identityInfo).withUnsafeBytes { Data($0) }
    }

    static func encryptionKey(from bip39Seed: Data) -> SymmetricKey {
        derive(seed: bip39Seed, info: encryptionInfo)
    }
}
