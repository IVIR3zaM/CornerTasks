import XCTest
import CryptoKit
@testable import CornerTasks

final class CryptoTests: XCTestCase {

    // MARK: - Test fixture (BIP-39 standard)

    /// Standard BIP-39 vector — entropy of all zeros.
    private let abandonEntropy = Data(repeating: 0x00, count: 16)
    private let abandonMnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    /// PBKDF2 seed for the abandon mnemonic with the empty passphrase. (The Trezor/BIP-39 reference
    /// vectors use passphrase `"TREZOR"` and produce `c55257c3...`; we use `""` per CornerTasks spec.)
    private let abandonSeedHex =
        "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4"

    func testBip39SeedTrezorPassphrase() {
        // Belt-and-braces against PBKDF2 regressions: official Trezor vector with passphrase "TREZOR".
        let seed = Mnemonic.toSeed(abandonMnemonic, passphrase: "TREZOR")
        XCTAssertEqual(seed.hex, "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04")
    }

    // MARK: - BIP-39

    func testBip39EntropyToMnemonic() throws {
        let m = try Mnemonic.fromEntropy(abandonEntropy)
        XCTAssertEqual(m, abandonMnemonic)
    }

    func testBip39MnemonicToEntropy() throws {
        let e = try Mnemonic.toEntropy(abandonMnemonic)
        XCTAssertEqual(e, abandonEntropy)
    }

    func testBip39SeedKnownAnswer() {
        let seed = Mnemonic.toSeed(abandonMnemonic)
        XCTAssertEqual(seed.hex, abandonSeedHex)
    }

    func testInvalidChecksumRejected() {
        // Last word `about` flipped to `abandon` breaks the checksum.
        let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
        XCTAssertFalse(Mnemonic.validate(bad))
    }

    func testGeneratedMnemonicsValidate() throws {
        for _ in 0..<5 {
            let m = try Mnemonic.generate()
            XCTAssertEqual(m.split(separator: " ").count, 12)
            XCTAssertTrue(Mnemonic.validate(m))
        }
    }

    // MARK: - did:key encoding (W3C test vector)

    /// W3C did-method-key Ed25519 example DID — round-trip decode → encode must reproduce it,
    /// and the multicodec prefix bytes must be `0xed 0x01` (§8.5).
    func testDidKeyW3CExampleRoundTrip() throws {
        let did = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
        let pub = try Identity.publicKey(fromDid: did)
        XCTAssertEqual(pub.count, 32)
        XCTAssertEqual(Identity.encodeDid(publicKey: pub), did)
    }

    func testDidKeyEncodeDecodeArbitraryKey() throws {
        // Random 32-byte Ed25519 pubkey — encoder and decoder are mutual inverses.
        let pub = Data((0..<32).map { UInt8($0) })
        let did = Identity.encodeDid(publicKey: pub)
        XCTAssertTrue(did.hasPrefix("did:key:z"))
        XCTAssertEqual(try Identity.publicKey(fromDid: did), pub)
    }

    // MARK: - Identity (stable across runs)

    func testMnemonicToDidIsStable() throws {
        let seed = Mnemonic.toSeed(abandonMnemonic)
        let id1 = try Identity.fromBip39Seed(seed)
        let id2 = try Identity.fromBip39Seed(seed)
        XCTAssertEqual(id1.accountDid, id2.accountDid)
        XCTAssertTrue(id1.accountDid.hasPrefix("did:key:z"))
    }

    func testSignVerifyRoundTrip() throws {
        let id = try Identity.fromBip39Seed(Mnemonic.toSeed(abandonMnemonic))
        let msg = Data("hello cornertasks".utf8)
        let sig = try id.sign(msg)
        XCTAssertTrue(try Identity.verify(signature: sig, message: msg, did: id.accountDid))
        // Wrong message must fail.
        XCTAssertFalse(try Identity.verify(signature: sig, message: Data("nope".utf8), did: id.accountDid))
    }

    // MARK: - AES-256-GCM round-trip

    func testEncryptDecryptRoundTrip() throws {
        let key = DataKey.encryptionKey(from: Mnemonic.toSeed(abandonMnemonic))
        let pt = Data("the quick brown fox".utf8)
        let aad = Data("did:key:abc|task-1|event-1".utf8)
        let (ct, nonce) = try SymmetricBox.seal(plaintext: pt, key: key, aad: aad)
        let recovered = try SymmetricBox.open(ciphertext: ct, nonce: nonce, key: key, aad: aad)
        XCTAssertEqual(recovered, pt)
    }

    func testWrongKeyFails() throws {
        let goodKey = DataKey.encryptionKey(from: Mnemonic.toSeed(abandonMnemonic))
        let badKey = SymmetricKey(size: .bits256)
        let pt = Data("secret".utf8)
        let aad = Data("aad".utf8)
        let (ct, nonce) = try SymmetricBox.seal(plaintext: pt, key: goodKey, aad: aad)
        XCTAssertThrowsError(try SymmetricBox.open(ciphertext: ct, nonce: nonce, key: badKey, aad: aad))
    }

    func testWrongAadFails() throws {
        let key = DataKey.encryptionKey(from: Mnemonic.toSeed(abandonMnemonic))
        let pt = Data("secret".utf8)
        let (ct, nonce) = try SymmetricBox.seal(plaintext: pt, key: key, aad: Data("aad-1".utf8))
        XCTAssertThrowsError(try SymmetricBox.open(ciphertext: ct, nonce: nonce, key: key, aad: Data("aad-2".utf8)))
    }

    // MARK: - Cross-implementation fixtures

    /// Loads `docs/crypto-vectors.json` and asserts our implementation reproduces every value.
    /// Iteration 8 (web crypto) consumes the same file.
    func testCrossImplVectorsMatch() throws {
        let url = repoURL().appendingPathComponent("docs/crypto-vectors.json")
        let data = try Data(contentsOf: url)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["mnemonic"] as? String, abandonMnemonic)
        XCTAssertEqual(json["bip39SeedHex"] as? String, abandonSeedHex)

        let bip39Seed = Mnemonic.toSeed(abandonMnemonic)
        let identitySeed = DataKey.identitySeed(from: bip39Seed)
        let encKey = DataKey.encryptionKey(from: bip39Seed)
        XCTAssertEqual(json["identitySeedHex"] as? String, identitySeed.hex)
        XCTAssertEqual(json["encryptionKeyHex"] as? String, encKey.hex)

        let identity = try Identity.fromBip39Seed(bip39Seed)
        XCTAssertEqual(json["accountDid"] as? String, identity.accountDid)
        XCTAssertEqual(json["publicKeyHex"] as? String, identity.publicKey.rawRepresentation.hex)

        // Encrypted-payload vector with a fixed nonce.
        let aes = json["aesGcm"] as! [String: Any]
        let plaintext = (aes["plaintext"] as! String).data(using: .utf8)!
        let aad = (aes["aad"] as! String).data(using: .utf8)!
        let nonce = Data(hex: aes["nonceHex"] as! String)!
        let (ct, gotNonce) = try SymmetricBox.seal(plaintext: plaintext, key: encKey, aad: aad, nonce: nonce)
        XCTAssertEqual(gotNonce, nonce)
        XCTAssertEqual(aes["ciphertextHex"] as? String, ct.hex)

        // DID-JWT vector — header + payload base64url are stable; signature is randomized
        // by Apple's CryptoKit (RFC 8032 permits this) so we only assert it verifies.
        let didJwtFixture = json["didJwt"] as! [String: Any]
        let aud = didJwtFixture["audience"] as! String
        let nonceStr = didJwtFixture["nonce"] as! String
        let iat = didJwtFixture["iat"] as! Int
        let jwt = try identity.makeDidJwt(audience: aud, nonce: nonceStr, iat: iat)
        let parts = jwt.split(separator: ".")
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(didJwtFixture["headerB64Url"] as? String, String(parts[0]))
        XCTAssertEqual(didJwtFixture["payloadB64Url"] as? String, String(parts[1]))
        let signingInput = Data("\(parts[0]).\(parts[1])".utf8)
        let sig = Base64Url.decode(String(parts[2]))!
        XCTAssertTrue(try Identity.verify(signature: sig, message: signingInput, did: identity.accountDid))
    }

    // MARK: - Helpers

    private func repoURL() -> URL {
        // This file lives at <repo>/apps/macos/Tests/CornerTasksTests/CryptoTests.swift
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // CornerTasksTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // macos
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent() // repo root
    }
}

private extension Data {
    init?(hex: String) {
        let chars = Array(hex)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let b = UInt8(String(chars[i...i+1]), radix: 16) else { return nil }
            out.append(b)
            i += 2
        }
        self = out
    }
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

private extension SymmetricKey {
    var hex: String { withUnsafeBytes { Data($0) }.hex }
}
