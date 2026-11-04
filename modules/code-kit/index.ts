// code-kit: this app's local Expo module (SPEC §6.2, D13). detectBarcodes(uri) decodes every barcode in an image file:
// iOS Vision (VNDetectBarcodesRequest, all symbologies), Android ML Kit barcode-scanning 17.3.0 (bundled model, all
// formats). `format` is the platform's name (Vision symbology raw value / our id from Kotlin); map it with
// formatFromHint (src/engine/barcode/formats.ts). Used by photo/screenshot import (P6) and the dev self-test (A6).
import { requireNativeModule } from 'expo';

export type DetectedCode = {
  value: string;
  /** "VNBarcodeSymbologyEAN13" (iOS) or "ean13" (Android); "other" on Android for symbologies we do not store. */
  format: string;
  /** Raw payload bytes when the platform has them (iOS 17+, ML Kit). */
  bytesBase64?: string;
  /** Normalised box, top-left origin, in the upright image. */
  box: { x: number; y: number; w: number; h: number };
};

type CodeKit = {
  detectBarcodes(uri: string): Promise<DetectedCode[]>;
  transcodeImage(inUri: string, outUri: string, format: 'png' | 'jpeg', maxEdge: number, quality: number): Promise<{ width: number; height: number }>;
};

const CodeKitModule = requireNativeModule<CodeKit>('CodeKit');

export function detectBarcodes(uri: string): Promise<DetectedCode[]> {
  return CodeKitModule.detectBarcodes(uri);
}

/**
 * Re-encodes an image file (P6, D37.6): PNG for the Catima export, EXIF-free JPEG for card photos. Upright, drawn on
 * white, long edge ≤ maxEdge (0 = keep the size). `outUri` is a file:// URI; its folder is created.
 */
export function transcodeImage(inUri: string, outUri: string, format: 'png' | 'jpeg', maxEdge = 0, quality = 0.85): Promise<{ width: number; height: number }> {
  return CodeKitModule.transcodeImage(inUri, outUri, format, maxEdge, quality);
}
