// probe.swift — the blind-set author's OWN 2D/Code128 symbol generator via Apple CoreImage.
// NOT the engine, NOT evidence: used only to observe how macOS Vision reports QR / Aztec / PDF417 / Code 128
// payloads (text encoding without ECI, symbology names) on symbols whose content is known with certainty.
//
// Usage: swift probe.swift <qr|aztec|pdf417|code128> <text|@file> <out.png> [scalePx=4] [full|dim] [latin1]
//   text is encoded as UTF-8 bytes (default) or ISO-8859-1 when `latin1` is given; CoreImage inserts no ECI.
import Foundation
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: probe.swift <qr|aztec|pdf417|code128> <text|@file> <out.png> [scale] [full|dim] [latin1]\n".data(using: .utf8)!)
    exit(2)
}
let kind = args[1]
var text = args[2]
if text.hasPrefix("@") { text = try! String(contentsOfFile: String(text.dropFirst()), encoding: .utf8) }
let outPath = args[3]
let scale = args.count > 4 ? CGFloat(Double(args[4]) ?? 4) : 4
let dim = args.count > 5 && args[5] == "dim"
let latin1 = args.count > 6 && args[6] == "latin1"
guard let data = latin1 ? text.data(using: .isoLatin1) : text.data(using: .utf8) else {
    FileHandle.standardError.write("cannot encode text\n".data(using: .utf8)!); exit(3)
}

let filterName: String
switch kind {
case "qr": filterName = "CIQRCodeGenerator"
case "aztec": filterName = "CIAztecCodeGenerator"
case "pdf417": filterName = "CIPDF417BarcodeGenerator"
case "code128": filterName = "CICode128BarcodeGenerator"
default: FileHandle.standardError.write("unknown kind\n".data(using: .utf8)!); exit(2)
}
guard let filter = CIFilter(name: filterName) else { exit(4) }
filter.setValue(data, forKey: "inputMessage")
if kind == "qr" { filter.setValue("M", forKey: "inputCorrectionLevel") }
if kind == "code128" { filter.setValue(10, forKey: "inputQuietSpace") }
guard let img = filter.outputImage else {
    FileHandle.standardError.write("no output image (capacity or charset)\n".data(using: .utf8)!); exit(5)
}
// Integer scaling with nearest-neighbour so modules stay crisp; then a quiet zone of 10 modules on every side.
let scaled = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
let ctx = CIContext(options: [.outputColorSpace: CGColorSpaceCreateDeviceGray(), .workingColorSpace: CGColorSpaceCreateDeviceGray()])
let extent = scaled.extent.integral
guard let cg = ctx.createCGImage(scaled, from: extent, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray()) else { exit(6) }
let pad = Int(10 * scale)
let w = cg.width + 2 * pad, h = cg.height + 2 * pad
var buf = [UInt8](repeating: 0xFF, count: w * h)
let cs = CGColorSpaceCreateDeviceGray()
let bctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue)!
bctx.setFillColor(CGColor(gray: 1, alpha: 1)); bctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
bctx.interpolationQuality = CGInterpolationQuality.none
bctx.draw(cg, in: CGRect(x: pad, y: pad, width: cg.width, height: cg.height))
// Re-quantise to two levels (CoreImage may leave grey edges); dim mode = #333 on #bbb (SPEC §13 proxy).
for i in 0..<buf.count { buf[i] = buf[i] < 128 ? (dim ? 0x33 : 0x00) : (dim ? 0xBB : 0xFF) }
let out = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue)!.makeImage()!
let rep = NSBitmapImageRep(cgImage: out)
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: outPath))
print("\(outPath) \(w)x\(h)")
