package expo.modules.codekit

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// code-kit (SPEC §6.2, D13): still-image barcode decoding for photo/screenshot import and the dev self-test (A6).
// ML Kit barcode scanning with the BUNDLED model, ALL formats (loyalty cards are mostly 1D). Image loading copied from
// card-scanner's card-kit (P6, emulator-verified there). Returns [{ value, format, bytesBase64?, box }]; `format` is our
// own format name (mapped in JS by formatFromHint; "other" for symbologies we do not store).
private const val MIN_SIDE = 32

class CodeKitModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CodeKit")

    AsyncFunction("detectBarcodes") { uri: String, promise: Promise ->
      val bitmap = try {
        atLeast(loadUpright(uri), MIN_SIDE)
      } catch (e: Exception) {
        return@AsyncFunction promise.reject("E_IMAGE", "Could not open the image: ${e.message}", e)
      }
      val w = bitmap.width.toDouble()
      val h = bitmap.height.toDouble()
      val options = BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build()
      val scanner = BarcodeScanning.getClient(options)
      scanner.process(InputImage.fromBitmap(bitmap, 0))
        .addOnSuccessListener { codes ->
          val out = codes.map { c ->
            val b = c.boundingBox
            val item = mutableMapOf<String, Any>(
              "value" to (c.rawValue ?: ""),
              "format" to formatName(c.format),
              "box" to if (b != null) mapOf("x" to b.left / w, "y" to b.top / h, "w" to b.width() / w, "h" to b.height() / h) else mapOf("x" to 0.0, "y" to 0.0, "w" to 0.0, "h" to 0.0),
            )
            c.rawBytes?.let { item["bytesBase64"] = Base64.encodeToString(it, Base64.NO_WRAP) }
            item
          }
          bitmap.recycle()
          scanner.close()
          promise.resolve(out)
        }
        .addOnFailureListener { e ->
          bitmap.recycle()
          scanner.close()
          promise.reject("E_BARCODE", e.message ?: "Barcode detection failed", e)
        }
    }

    // P6 (D37.6, D42): re-encode an image as PNG (Catima export: only card_<n>_<side>.png entries) or as an EXIF-free
    // JPEG (card photos, SPEC §4.1: long edge ≤ maxEdge, quality q). Upright pixels drawn on white; Bitmap.compress
    // writes no metadata, so no EXIF/GPS is carried over.
    AsyncFunction("transcodeImage") { inUri: String, outUri: String, format: String, maxEdge: Int, quality: Double ->
      val src = loadUpright(inUri)
      val longest = maxOf(src.width, src.height)
      val scale = if (maxEdge > 0 && longest > maxEdge) maxEdge.toDouble() / longest else 1.0
      val w = maxOf(1, Math.round(src.width * scale).toInt())
      val h = maxOf(1, Math.round(src.height * scale).toInt())
      val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(out)
      canvas.drawColor(Color.WHITE)
      canvas.drawBitmap(src, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
      src.recycle()
      val file = toFile(outUri)
      file.parentFile?.mkdirs()
      val ok = FileOutputStream(file).use { s ->
        out.compress(if (format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, (quality * 100).toInt().coerceIn(1, 100), s)
      }
      out.recycle()
      if (!ok) throw CodedException("E_IMAGE", "Could not write $outUri", null)
      mapOf("width" to w, "height" to h)
    }
  }

  // ML Kit refuses images under 32 px on a side ("InputImage width and height should be at least 32!", P5 decode set:
  // a 2 px Data Matrix PNG is 28 px). A smaller image is centred on white — more quiet zone, same code.
  private fun atLeast(bitmap: Bitmap, min: Int): Bitmap {
    if (bitmap.width >= min && bitmap.height >= min) return bitmap
    val out = Bitmap.createBitmap(maxOf(bitmap.width, min), maxOf(bitmap.height, min), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(bitmap, ((out.width - bitmap.width) / 2).toFloat(), ((out.height - bitmap.height) / 2).toFloat(), null)
    bitmap.recycle()
    return out
  }

  private fun formatName(f: Int): String = when (f) {
    Barcode.FORMAT_CODE_128 -> "code128"
    Barcode.FORMAT_CODE_39 -> "code39"
    Barcode.FORMAT_CODE_93 -> "code93"
    Barcode.FORMAT_CODABAR -> "codabar"
    Barcode.FORMAT_EAN_13 -> "ean13"
    Barcode.FORMAT_EAN_8 -> "ean8"
    Barcode.FORMAT_ITF -> "itf"
    Barcode.FORMAT_UPC_A -> "upca"
    Barcode.FORMAT_UPC_E -> "upce"
    Barcode.FORMAT_QR_CODE -> "qr"
    Barcode.FORMAT_PDF417 -> "pdf417"
    Barcode.FORMAT_AZTEC -> "aztec"
    Barcode.FORMAT_DATA_MATRIX -> "datamatrix"
    else -> "other"
  }

  private fun toFile(uri: String): File {
    val parsed = Uri.parse(uri)
    return File(if (parsed.scheme == "file") parsed.path ?: uri else uri)
  }

  private fun loadUpright(uri: String): Bitmap {
    val file = toFile(uri)
    val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
    val raw = BitmapFactory.decodeFile(file.path, opts) ?: throw CodedException("E_IMAGE", "Could not decode $uri", null)
    val orientation = try {
      ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } catch (e: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
      else -> return raw
    }
    return Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also { if (it !== raw) raw.recycle() }
  }
}
