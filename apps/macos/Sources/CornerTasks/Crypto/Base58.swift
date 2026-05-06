import Foundation

enum Base58 {
    private static let alphabet: [Character] = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    static func encode(_ data: Data) -> String {
        var leadingZeros = 0
        for b in data {
            if b == 0 { leadingZeros += 1 } else { break }
        }

        var num = Array(data)
        var digits: [Int] = []
        while !num.isEmpty {
            var remainder = 0
            var quotient: [UInt8] = []
            for byte in num {
                let acc = remainder * 256 + Int(byte)
                let q = acc / 58
                remainder = acc % 58
                if !quotient.isEmpty || q != 0 {
                    quotient.append(UInt8(q))
                }
            }
            digits.append(remainder)
            num = quotient
        }

        var out = String(repeating: "1", count: leadingZeros)
        for d in digits.reversed() {
            out.append(alphabet[d])
        }
        return out
    }

    static func decode(_ s: String) -> Data? {
        var leadingOnes = 0
        for c in s {
            if c == "1" { leadingOnes += 1 } else { break }
        }
        var num: [UInt8] = []
        for c in s {
            guard let idx = alphabet.firstIndex(of: c) else { return nil }
            var carry = idx
            var newNum: [UInt8] = []
            for byte in num {
                let acc = Int(byte) * 58 + carry
                newNum.append(UInt8(acc & 0xff))
                carry = acc >> 8
            }
            while carry > 0 {
                newNum.append(UInt8(carry & 0xff))
                carry >>= 8
            }
            num = newNum
        }
        var out = Data(repeating: 0, count: leadingOnes)
        out.append(contentsOf: num.reversed())
        return out
    }
}
