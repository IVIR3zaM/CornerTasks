import CryptoKit
import Foundation

enum MnemonicError: Error, Equatable {
    case wordlistMissing
    case invalidWordCount
    case unknownWord(String)
    case invalidChecksum
    case invalidEntropyLength
}

enum Mnemonic {
    static let wordCount = 12
    static let entropyBytes = 16

    private static let wordlistCache: [String] = {
        guard let url = Bundle.module.url(forResource: "bip39-english", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return []
        }
        return text.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }
    }()

    static func wordlist() throws -> [String] {
        if wordlistCache.count != 2048 {
            throw MnemonicError.wordlistMissing
        }
        return wordlistCache
    }

    static func generate() throws -> String {
        var entropy = Data(count: entropyBytes)
        let result = entropy.withUnsafeMutableBytes { buf -> Int32 in
            SecRandomCopyBytes(kSecRandomDefault, buf.count, buf.baseAddress!)
        }
        precondition(result == errSecSuccess, "SecRandomCopyBytes failed")
        return try fromEntropy(entropy)
    }

    static func fromEntropy(_ entropy: Data) throws -> String {
        guard entropy.count == entropyBytes else { throw MnemonicError.invalidEntropyLength }
        let words = try wordlist()
        let checksum = SHA256.hash(data: entropy)
        let checksumByte = Array(checksum)[0]
        let checksumBitCount = (entropy.count * 8) / 32 // 4 for 16-byte entropy

        // Build a bit string of (entropy bits) + (first checksumBitCount of SHA-256)
        var bits = ""
        bits.reserveCapacity(entropy.count * 8 + checksumBitCount)
        for byte in entropy {
            bits.append(String(byte, radix: 2).leftPadded(to: 8, with: "0"))
        }
        let csBits = String(checksumByte, radix: 2).leftPadded(to: 8, with: "0")
        bits.append(String(csBits.prefix(checksumBitCount)))

        // Split into 11-bit groups
        var indices: [Int] = []
        var i = bits.startIndex
        while i < bits.endIndex {
            let next = bits.index(i, offsetBy: 11)
            let group = bits[i..<next]
            indices.append(Int(group, radix: 2)!)
            i = next
        }
        return indices.map { words[$0] }.joined(separator: " ")
    }

    static func validate(_ mnemonic: String) -> Bool {
        do {
            _ = try toEntropy(mnemonic)
            return true
        } catch {
            return false
        }
    }

    static func toEntropy(_ mnemonic: String) throws -> Data {
        let words = mnemonic.split(separator: " ").map { String($0) }
        guard words.count == wordCount else { throw MnemonicError.invalidWordCount }
        let list = try wordlist()
        let lookup = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1, $0) })

        var bits = ""
        bits.reserveCapacity(words.count * 11)
        for w in words {
            guard let idx = lookup[w] else { throw MnemonicError.unknownWord(w) }
            bits.append(String(idx, radix: 2).leftPadded(to: 11, with: "0"))
        }

        let entropyBitCount = (bits.count * 32) / 33
        let checksumBitCount = bits.count - entropyBitCount
        let entropyBits = bits.prefix(entropyBitCount)
        let checksumBits = String(bits.suffix(checksumBitCount))

        var entropy = Data()
        var idx = entropyBits.startIndex
        while idx < entropyBits.endIndex {
            let next = entropyBits.index(idx, offsetBy: 8)
            let byte = UInt8(entropyBits[idx..<next], radix: 2)!
            entropy.append(byte)
            idx = next
        }

        let computedChecksum = SHA256.hash(data: entropy)
        let csByte = Array(computedChecksum)[0]
        let computedBits = String(String(csByte, radix: 2).leftPadded(to: 8, with: "0").prefix(checksumBitCount))
        if computedBits != checksumBits {
            throw MnemonicError.invalidChecksum
        }
        return entropy
    }

    /// BIP-39 seed: PBKDF2-HMAC-SHA512(mnemonic, "mnemonic"+passphrase, 2048, 64).
    /// Inputs are NFKD-normalised per the spec.
    static func toSeed(_ mnemonic: String, passphrase: String = "") -> Data {
        let normalisedMnemonic = mnemonic.decomposedStringWithCompatibilityMapping
        let normalisedPass = ("mnemonic" + passphrase).decomposedStringWithCompatibilityMapping
        let pwd = Data(normalisedMnemonic.utf8)
        let salt = Data(normalisedPass.utf8)
        return PBKDF2.deriveHmacSHA512(password: pwd, salt: salt, iterations: 2048, length: 64)
    }
}

private extension String {
    func leftPadded(to length: Int, with pad: Character) -> String {
        guard count < length else { return self }
        return String(repeating: pad, count: length - count) + self
    }
}
