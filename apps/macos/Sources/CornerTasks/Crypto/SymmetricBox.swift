import CryptoKit
import Foundation

enum SymmetricBoxError: Error {
    case invalidNonce
    case invalidCiphertext
}

enum SymmetricBox {
    /// AES-256-GCM seal. Returns ciphertext||tag (combined) and the 12-byte nonce.
    static func seal(plaintext: Data, key: SymmetricKey, aad: Data, nonce: Data? = nil) throws -> (ciphertext: Data, nonce: Data) {
        let gcmNonce: AES.GCM.Nonce
        if let nonce = nonce {
            guard nonce.count == 12 else { throw SymmetricBoxError.invalidNonce }
            gcmNonce = try AES.GCM.Nonce(data: nonce)
        } else {
            gcmNonce = AES.GCM.Nonce()
        }
        let sealed = try AES.GCM.seal(plaintext, using: key, nonce: gcmNonce, authenticating: aad)
        var combined = Data()
        combined.append(sealed.ciphertext)
        combined.append(sealed.tag)
        return (combined, Data(gcmNonce))
    }

    static func open(ciphertext: Data, nonce: Data, key: SymmetricKey, aad: Data) throws -> Data {
        guard nonce.count == 12 else { throw SymmetricBoxError.invalidNonce }
        guard ciphertext.count >= 16 else { throw SymmetricBoxError.invalidCiphertext }
        let tag = ciphertext.suffix(16)
        let ct = ciphertext.prefix(ciphertext.count - 16)
        let sealed = try AES.GCM.SealedBox(
            nonce: try AES.GCM.Nonce(data: nonce),
            ciphertext: ct,
            tag: tag
        )
        return try AES.GCM.open(sealed, using: key, authenticating: aad)
    }
}
