import XCTest
@testable import CornerTasks

private final class InMemoryMnemonicProvider: MnemonicProvider {
    var stored: String?
    func save(_ mnemonic: String) throws { stored = mnemonic }
    func load() throws -> String? { stored }
    func clear() throws { stored = nil }
}

final class AccountManagerTests: XCTestCase {
    func testGenerateProducesStableDidAcrossReloads() throws {
        let provider = InMemoryMnemonicProvider()
        let manager = AccountManager(store: provider)
        let mnemonic = try manager.generateNew()
        XCTAssertEqual(mnemonic.split(separator: " ").count, 12)
        guard let didA = manager.did else { return XCTFail("expected did") }
        XCTAssertTrue(didA.hasPrefix("did:key:z"))

        // Same mnemonic in keychain → same DID after a fresh manager.
        let manager2 = AccountManager(store: provider)
        XCTAssertNil(manager2.did, "init must not auto-load — Keychain access is deferred")
        manager2.loadIfPresent()
        XCTAssertEqual(manager2.did, didA)
        XCTAssertEqual(manager2.mnemonic, mnemonic)
        // Idempotent: a second call is a no-op (no extra store read).
        manager2.loadIfPresent()
        XCTAssertEqual(manager2.did, didA)
    }

    func testImportNormalisesAndProducesSameDidAsGenerate() throws {
        let provider = InMemoryMnemonicProvider()
        let m1 = try AccountManager(store: provider).generateNew()
        XCTAssertNotNil(provider.stored)

        let provider2 = InMemoryMnemonicProvider()
        let manager = AccountManager(store: provider2)
        let normalised = try manager.importMnemonic("  \(m1.uppercased())  \n  ")
        XCTAssertEqual(normalised, m1.lowercased())
        let other = AccountManager(store: provider)
        other.loadIfPresent()
        XCTAssertEqual(manager.did, other.did)
    }

    func testImportRejectsInvalidMnemonic() {
        let manager = AccountManager(store: InMemoryMnemonicProvider())
        XCTAssertThrowsError(try manager.importMnemonic("not a real mnemonic at all not even close")) { err in
            XCTAssertEqual(err as? AccountError, .invalidMnemonic)
        }
        XCTAssertNil(manager.did)
    }

    func testForgetClearsState() throws {
        let provider = InMemoryMnemonicProvider()
        let manager = AccountManager(store: provider)
        _ = try manager.generateNew()
        XCTAssertNotNil(manager.did)

        try manager.forget()
        XCTAssertNil(manager.did)
        XCTAssertNil(manager.mnemonic)
        XCTAssertNil(provider.stored)
    }

    func testNormaliseLowercasesAndCollapsesWhitespace() {
        let raw = "  Word1   word2\n word3 \tword4 "
        XCTAssertEqual(AccountManager.normalise(raw), "word1 word2 word3 word4")
    }
}
