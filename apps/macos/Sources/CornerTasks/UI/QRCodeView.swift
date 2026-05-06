import SwiftUI
import CoreImage.CIFilterBuiltins
import AppKit

struct QRCodeView: View {
    let payload: String
    var size: CGFloat = 220

    var body: some View {
        Group {
            if let image = Self.makeImage(payload: payload, side: size) {
                Image(nsImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size, height: size)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary)
                    .frame(width: size, height: size)
                    .overlay(Text("QR unavailable").font(.caption).foregroundStyle(.secondary))
            }
        }
    }

    static func makeImage(payload: String, side: CGFloat) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let ci = filter.outputImage else { return nil }
        let scale = side / ci.extent.width
        let scaled = ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let rep = NSCIImageRep(ciImage: scaled)
        let img = NSImage(size: rep.size)
        img.addRepresentation(rep)
        return img
    }
}
