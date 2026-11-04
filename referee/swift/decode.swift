// Referee R1 (SPEC §13): macOS Vision decodes PNG files and prints what it read — an independent judge of our renderer
// (Apple's reader, the same engine iOS uses; not a till). Read-only; no network.
// Usage: decode <file.png>... | <directory>   → one line per file: "<path>\t<value>\t<symbology>" ("\t\t" when nothing
// was found; several lines when several codes are found). Build once: swiftc -O referee/swift/decode.swift -o artifacts/referee/decode
import Foundation
import Vision

func decode(_ path: String) -> [(String, String)] {
  guard let data = FileManager.default.contents(atPath: path), let image = CGImageSourceCreateWithData(data as CFData, nil),
        let cg = CGImageSourceCreateImageAtIndex(image, 0, nil) else { return [] }
  let request = VNDetectBarcodesRequest()
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([request]) } catch { return [] }
  var out: [(String, String)] = []
  for r in request.results ?? [] {
    out.append((r.payloadStringValue ?? "", r.symbology.rawValue))
  }
  return out
}

var files: [String] = []
for arg in CommandLine.arguments.dropFirst() {
  var isDir: ObjCBool = false
  if FileManager.default.fileExists(atPath: arg, isDirectory: &isDir), isDir.boolValue {
    let items = (try? FileManager.default.contentsOfDirectory(atPath: arg)) ?? []
    files += items.filter { $0.hasSuffix(".png") }.sorted().map { (arg as NSString).appendingPathComponent($0) }
  } else {
    files.append(arg)
  }
}
for f in files {
  let results = decode(f)
  if results.isEmpty { print("\(f)\t\t") } else { for (v, s) in results { print("\(f)\t\(v.replacingOccurrences(of: "\t", with: "\\t").replacingOccurrences(of: "\n", with: "\\n"))\t\(s)") } }
}
