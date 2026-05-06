import CryptoKit
import Foundation

enum PBKDF2 {
    static func deriveHmacSHA512(password: Data, salt: Data, iterations: Int, length: Int) -> Data {
        precondition(iterations > 0)
        precondition(length > 0)
        let key = SymmetricKey(data: password)
        var output = Data()
        var blockIndex: UInt32 = 1
        while output.count < length {
            var blockSalt = salt
            var be = blockIndex.bigEndian
            withUnsafeBytes(of: &be) { blockSalt.append(contentsOf: $0) }

            var u = Data(HMAC<SHA512>.authenticationCode(for: blockSalt, using: key))
            var t = u
            for _ in 1..<iterations {
                u = Data(HMAC<SHA512>.authenticationCode(for: u, using: key))
                for i in 0..<t.count {
                    t[i] ^= u[i]
                }
            }
            output.append(t)
            blockIndex &+= 1
        }
        return output.prefix(length)
    }
}
