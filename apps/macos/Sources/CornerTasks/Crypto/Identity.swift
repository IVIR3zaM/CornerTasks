import CryptoKit
import Foundation

enum IdentityError: Error {
    case badDid
    case verificationFailed
}

struct Identity {
    let privateKey: Curve25519.Signing.PrivateKey
    let publicKey: Curve25519.Signing.PublicKey
    let accountDid: String
    /// methodSpecificId is the part of the DID after `did:key:` (e.g. `z6Mk...`).
    let methodSpecificId: String

    /// Build an Identity from a 32-byte seed (the output of HKDF for identity).
    static func fromIdentitySeed(_ seed: Data) throws -> Identity {
        let priv = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
        return make(privateKey: priv)
    }

    /// Convenience: build from the BIP-39 seed.
    static func fromBip39Seed(_ bip39Seed: Data) throws -> Identity {
        try fromIdentitySeed(DataKey.identitySeed(from: bip39Seed))
    }

    private static func make(privateKey: Curve25519.Signing.PrivateKey) -> Identity {
        let pub = privateKey.publicKey
        let did = encodeDid(publicKey: pub.rawRepresentation)
        let msi = String(did.dropFirst("did:key:".count))
        return Identity(privateKey: privateKey, publicKey: pub, accountDid: did, methodSpecificId: msi)
    }

    /// `did:key` encoding for an Ed25519 public key (multicodec 0xed 0x01, base58btc, multibase prefix `z`).
    static func encodeDid(publicKey: Data) -> String {
        var prefixed = Data([0xed, 0x01])
        prefixed.append(publicKey)
        return "did:key:z" + Base58.encode(prefixed)
    }

    /// Recover the 32-byte Ed25519 public key from a `did:key` string.
    static func publicKey(fromDid did: String) throws -> Data {
        guard did.hasPrefix("did:key:z") else { throw IdentityError.badDid }
        let body = String(did.dropFirst("did:key:z".count))
        guard let raw = Base58.decode(body) else { throw IdentityError.badDid }
        guard raw.count == 34, raw[0] == 0xed, raw[1] == 0x01 else { throw IdentityError.badDid }
        return raw.suffix(32)
    }

    func sign(_ message: Data) throws -> Data {
        try privateKey.signature(for: message)
    }

    static func verify(signature: Data, message: Data, did: String) throws -> Bool {
        let pkBytes = try publicKey(fromDid: did)
        let pub = try Curve25519.Signing.PublicKey(rawRepresentation: pkBytes)
        return pub.isValidSignature(signature, for: message)
    }

    /// Build a compact JWS DID-JWT per `docs/sync-protocol.md` §8.2. `exp = iat + 300`.
    func makeDidJwt(audience: String, nonce: String, iat: Int) throws -> String {
        let kid = "\(accountDid)#\(methodSpecificId)"
        let header = "{\"alg\":\"EdDSA\",\"typ\":\"JWT\",\"kid\":\"\(kid)\"}"
        let exp = iat + 300
        let payload = "{\"iss\":\"\(accountDid)\",\"sub\":\"\(accountDid)\",\"aud\":\"\(audience)\",\"nonce\":\"\(nonce)\",\"iat\":\(iat),\"exp\":\(exp)}"
        let h = Base64Url.encode(Data(header.utf8))
        let p = Base64Url.encode(Data(payload.utf8))
        let signingInput = "\(h).\(p)"
        let sig = try sign(Data(signingInput.utf8))
        return "\(signingInput).\(Base64Url.encode(sig))"
    }
}
