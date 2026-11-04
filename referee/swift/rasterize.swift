// Rasteriser for the referees (SPEC §5.2/§13): module matrix JSON → PNG at module width N px, in two colours, with NO
// anti-aliasing (integer rectangles, nearest-neighbour). Independent of the app's own PNG encoder (src/engine/barcode/png.ts).
// Input: a JSON file with an array of jobs: { "out": "path.png", "modulePx": 3, "fg": "#000000", "bg": "#ffffff",
//   "width": W, "height": H, "rows": ["0110…", …] }  — rows are module rows top-first, '1' = dark, quiet zones included.
// Usage: rasterize <jobs.json>   Build once: swiftc -O referee/swift/rasterize.swift -o artifacts/referee/rasterize
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Job: Decodable { let out: String; let modulePx: Int; let fg: String; let bg: String; let width: Int; let height: Int; let rows: [String] }

func rgb(_ hex: String) -> (UInt8, UInt8, UInt8) {
  var s = hex; if s.hasPrefix("#") { s.removeFirst() }
  let v = UInt32(s, radix: 16) ?? 0
  return (UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff))
}

let args = CommandLine.arguments
guard args.count == 2, let data = FileManager.default.contents(atPath: args[1]) else {
  FileHandle.standardError.write("usage: rasterize <jobs.json>\n".data(using: .utf8)!); exit(2)
}
let jobs = try JSONDecoder().decode([Job].self, from: data)
var written = 0
for job in jobs {
  let n = job.modulePx, w = job.width * n, h = job.height * n
  let (fr, fg, fb) = rgb(job.fg), (br, bg, bb) = rgb(job.bg)
  var pixels = [UInt8](repeating: 0, count: w * h * 4)
  for y in 0..<job.height {
    let row = Array(job.rows[y].utf8)
    for x in 0..<job.width {
      let dark = x < row.count && row[x] == UInt8(ascii: "1")
      let (r, g, b) = dark ? (fr, fg, fb) : (br, bg, bb)
      for dy in 0..<n { for dx in 0..<n {
        let i = ((y * n + dy) * w + (x * n + dx)) * 4
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255
      } }
    }
  }
  let cs = CGColorSpaceCreateDeviceRGB()
  guard let provider = CGDataProvider(data: Data(pixels) as CFData),
        let image = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: cs,
                            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider,
                            decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { continue }
  let url = URL(fileURLWithPath: job.out)
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
  CGImageDestinationAddImage(dest, image, nil)
  if CGImageDestinationFinalize(dest) { written += 1 }
}
print("rasterize: \(written) of \(jobs.count) images written")
