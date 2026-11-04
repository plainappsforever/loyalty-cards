// decode.swift — blind-set referee: decodes PNG files with Apple Vision (VNDetectBarcodesRequest) on macOS.
// Independent of the app's own referee/swift/decode.swift (never read). Output: one JSON object per input
// file on stdout:
//   {"file": "<path>", "results": [{"symbology": "VNBarcodeSymbologyEAN13", "payload": "4006381333931",
//                                   "payloadBase64": "...", "confidence": 1.0}]}
// `payload` is Vision's payloadStringValue (null when Vision has none); `payloadBase64` is payloadData when
// available (macOS 14+). All supported symbologies are enabled explicitly. Usage:
//   swift decode.swift file1.png file2.png ...        (or: swift decode.swift @list.txt — one path per line)
//   swift decode.swift --info                          (OS version, request revision, enabled symbologies)
// Reviewed and kept by the second B1 author (2026-10-16). NOTE: payloadData is the symbol's raw codeword stream,
// not the message bytes — never compare it with a value.
import Foundation
import Vision
import ImageIO

func esc(_ s: String) -> String {
    var o = "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": o += "\\\""
        case "\\": o += "\\\\"
        case "\n": o += "\\n"
        case "\r": o += "\\r"
        case "\t": o += "\\t"
        default:
            if u.value < 0x20 { o += String(format: "\\u%04x", u.value) } else { o.unicodeScalars.append(u) }
        }
    }
    return o + "\""
}

var files = Array(CommandLine.arguments.dropFirst())
if files == ["--info"] {
    // Record the referee's identity next to every measured figure (macOS version, Vision request revision, symbologies)
    let req = VNDetectBarcodesRequest()
    let syms = ((try? req.supportedSymbologies()) ?? []).map { $0.rawValue }.joined(separator: ",")
    print("{\"os\": \(esc(ProcessInfo.processInfo.operatingSystemVersionString)), \"revision\": \(req.revision), \"symbologies\": \(esc(syms))}")
    exit(0)
}
if files.count == 1, files[0].hasPrefix("@") {
    let list = try! String(contentsOfFile: String(files[0].dropFirst()), encoding: .utf8)
    files = list.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
}
if files.isEmpty {
    FileHandle.standardError.write("usage: swift decode.swift <png>... | @list.txt\n".data(using: .utf8)!)
    exit(2)
}

for path in files {
    var results: [String] = []
    var error: String? = nil
    if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
       let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) {
        let req = VNDetectBarcodesRequest()
        if let all = try? req.supportedSymbologies(), !all.isEmpty { req.symbologies = all }
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do {
            try handler.perform([req])
            for obs in (req.results ?? []) {
                var fields = ["\"symbology\": \(esc(obs.symbology.rawValue))"]
                if let p = obs.payloadStringValue { fields.append("\"payload\": \(esc(p))") } else { fields.append("\"payload\": null") }
                if #available(macOS 14.0, *), let d = obs.payloadData {
                    fields.append("\"payloadBase64\": \(esc(d.base64EncodedString()))")
                }
                fields.append("\"confidence\": \(obs.confidence)")
                results.append("{" + fields.joined(separator: ", ") + "}")
            }
        } catch let e {
            error = "\(e)"
        }
    } else {
        error = "cannot load image"
    }
    var line = "{\"file\": \(esc(path)), \"results\": [" + results.joined(separator: ", ") + "]"
    if let e = error { line += ", \"error\": \(esc(e))" }
    line += "}"
    print(line)
}
