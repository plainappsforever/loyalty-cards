import CoreImage
import ExpoModulesCore
import ImageIO
import Vision

// code-kit (SPEC §6.2, D13): still-image barcode decoding for photo/screenshot import and the dev self-test (A6).
// detectBarcodes = VNDetectBarcodesRequest with EVERY symbology Vision knows (loyalty cards are mostly 1D). The image
// loading and the simulator CPU fallback are copied from card-scanner's card-kit (commit in its repo, P6), which ran them
// on the iOS 26.5 simulator. Returns [{ value, format, bytesBase64?, box }]; `format` is Vision's symbology raw value
// ("VNBarcodeSymbologyEAN13"), mapped to our ids in JS (formatFromHint). AsyncFunction = background queue.

final class ImageException: GenericException<String> {
  override var reason: String { "\(param)" }
}

public class CodeKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CodeKit")

    AsyncFunction("detectBarcodes") { (uri: String) -> [[String: Any]] in
      let image = try Self.loadUpright(uri)
      var request = VNDetectBarcodesRequest()
      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
      } catch {
        // simulator: no inference context on the default device → CPU
        request = VNDetectBarcodesRequest()
        Self.cpuOnSimulator(request)
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
      }
      #if targetEnvironment(simulator)
      // simulator: try the other model revisions on the CPU when the current one finds nothing (card-scanner P6)
      if (request.results ?? []).isEmpty {
        for rev in VNDetectBarcodesRequest.supportedRevisions.sorted(by: >) {
          let r = VNDetectBarcodesRequest()
          r.revision = rev
          Self.cpuOnSimulator(r)
          if (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([r])) != nil, !(r.results ?? []).isEmpty {
            request = r
            break
          }
        }
      }
      #endif
      return (request.results ?? []).map { o in
        var item: [String: Any] = [
          "value": o.payloadStringValue ?? "",
          "format": o.symbology.rawValue,
          "box": ["x": Double(o.boundingBox.minX), "y": Double(1 - o.boundingBox.maxY), "w": Double(o.boundingBox.width), "h": Double(o.boundingBox.height)],
        ]
        if #available(iOS 17.0, *), let data = o.payloadData { item["bytesBase64"] = data.base64EncodedString() }
        return item
      }
    }

    // P6 (D37.6, D42): re-encode an image as PNG (Catima export: only card_<n>_<side>.png entries) or as an EXIF-free
    // JPEG (card photos, SPEC §4.1: long edge ≤ maxEdge, quality q). Upright pixels drawn on white (a PNG with alpha
    // becomes an opaque JPEG instead of a black one); no metadata is copied, so no EXIF/GPS leaves or enters the app.
    AsyncFunction("transcodeImage") { (inUri: String, outUri: String, format: String, maxEdge: Int, quality: Double) -> [String: Any] in
      let image = try Self.redraw(try Self.loadUpright(inUri), maxEdge: maxEdge)
      let url = Self.fileUrl(outUri)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      let type = (format == "png" ? "public.png" : "public.jpeg") as CFString
      guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
        throw ImageException("Could not create \(outUri)")
      }
      let props: [CFString: Any] = format == "png" ? [:] : [kCGImageDestinationLossyCompressionQuality: quality]
      CGImageDestinationAddImage(dest, image, props as CFDictionary)
      guard CGImageDestinationFinalize(dest) else { throw ImageException("Could not write \(outUri)") }
      return ["width": image.width, "height": image.height]
    }
  }

  static func redraw(_ image: CGImage, maxEdge: Int) throws -> CGImage {
    let longest = max(image.width, image.height)
    let scale = (maxEdge > 0 && longest > maxEdge) ? Double(maxEdge) / Double(longest) : 1
    let w = max(1, Int((Double(image.width) * scale).rounded()))
    let h = max(1, Int((Double(image.height) * scale).rounded()))
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
      throw ImageException("Could not create a drawing context")
    }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let out = ctx.makeImage() else { throw ImageException("Could not draw the image") }
    return out
  }

  static func fileUrl(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil { return url }
    return URL(fileURLWithPath: uri)
  }

  static func loadUpright(_ uri: String) throws -> CGImage {
    let url = fileUrl(uri)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
      throw ImageException("Could not open the image at \(uri)")
    }
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let raw = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
    guard raw != 1, let o = CGImagePropertyOrientation(rawValue: raw) else { return image }
    let ci = CIImage(cgImage: image).oriented(o)
    guard let cg = CIContext().createCGImage(ci, from: ci.extent) else { throw ImageException("Could not orient the image") }
    return cg
  }

  static func cpuOnSimulator(_ request: VNRequest) {
    #if targetEnvironment(simulator)
    if #available(iOS 17.0, *) {
      if let devices = try? request.supportedComputeStageDevices {
        for (stage, list) in devices {
          if let cpu = list.first(where: { if case .cpu = $0 { return true } else { return false } }) { request.setComputeDevice(cpu, for: stage) }
        }
      }
    } else {
      request.usesCPUOnly = true
    }
    #endif
  }
}
