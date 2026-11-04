// Barcode formats the app stores and renders (SPEC §4.2 CHECK list, §5.1 format table). Pure data.
// Names across the systems we talk to: Catima (import/export), expo-camera (live scan types), bwip-js (encoder ids),
// Apple Vision (referee + still-image decoding symbology raw values), ML Kit (P5).
export const FORMAT_IDS = ['none', 'code128', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar', 'code39', 'code93', 'qr', 'aztec', 'pdf417', 'datamatrix'] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
export type FormatKind = '1d' | '2d' | 'none';

export type FormatInfo = {
  id: FormatId;
  /** Printed name, never translated ("Code 128"). */
  name: string;
  kind: FormatKind;
  catima: string | null;
  camera: string | null;
  bwip: string | null;
  /** Vision symbology raw values that mean this format (UPC-A is reported as EAN-13 with a leading 0). */
  vision: readonly string[];
  /** Quiet zone in modules on each side (left/right for 1D, all sides for 2D; D20). */
  quietLeft: number;
  quietRight: number;
  /** Smallest readable module in device pixels (D20: 3 for 1D, 4 for 2D). */
  minModulePx: number;
  /** Allowed characters of the canonical value (after normalise); null = any UTF-8. */
  charset: RegExp | null;
  minLength: number;
  maxLength: number;
  /** Fixed length(s) when the format has them; otherwise undefined. */
  fixedLengths?: readonly number[];
  /** GS1 mod-10 check digit on the last digit. */
  gs1Check?: boolean;
  /** ITF: even number of digits. */
  evenLength?: boolean;
};

const ONE_D = { kind: '1d' as const, minModulePx: 3 };
const TWO_D = { kind: '2d' as const, minModulePx: 4, quietLeft: 4, quietRight: 4, charset: null, minLength: 1, maxLength: 1000 };

export const FORMATS: Readonly<Record<FormatId, FormatInfo>> = {
  none: { id: 'none', name: 'Number only', kind: 'none', catima: null, camera: null, bwip: null, vision: [], quietLeft: 0, quietRight: 0, minModulePx: 0, charset: null, minLength: 0, maxLength: 200 },
  code128: { id: 'code128', name: 'Code 128', ...ONE_D, catima: 'CODE_128', camera: 'code128', bwip: 'code128', vision: ['VNBarcodeSymbologyCode128'], quietLeft: 10, quietRight: 10, charset: /^[\x20-\x7e]+$/, minLength: 1, maxLength: 80 },
  ean13: { id: 'ean13', name: 'EAN-13', ...ONE_D, catima: 'EAN_13', camera: 'ean13', bwip: 'ean13', vision: ['VNBarcodeSymbologyEAN13'], quietLeft: 11, quietRight: 7, charset: /^[0-9]+$/, minLength: 13, maxLength: 13, fixedLengths: [13], gs1Check: true },
  ean8: { id: 'ean8', name: 'EAN-8', ...ONE_D, catima: 'EAN_8', camera: 'ean8', bwip: 'ean8', vision: ['VNBarcodeSymbologyEAN8'], quietLeft: 7, quietRight: 7, charset: /^[0-9]+$/, minLength: 8, maxLength: 8, fixedLengths: [8], gs1Check: true },
  upca: { id: 'upca', name: 'UPC-A', ...ONE_D, catima: 'UPC_A', camera: 'upc_a', bwip: 'upca', vision: ['VNBarcodeSymbologyUPCE', 'VNBarcodeSymbologyEAN13'], quietLeft: 9, quietRight: 9, charset: /^[0-9]+$/, minLength: 12, maxLength: 12, fixedLengths: [12], gs1Check: true },
  upce: { id: 'upce', name: 'UPC-E', ...ONE_D, catima: 'UPC_E', camera: 'upc_e', bwip: 'upce', vision: ['VNBarcodeSymbologyUPCE'], quietLeft: 9, quietRight: 7, charset: /^[01][0-9]{7}$/, minLength: 8, maxLength: 8, fixedLengths: [8] },
  itf: { id: 'itf', name: 'ITF', ...ONE_D, catima: 'ITF', camera: 'itf14', bwip: 'interleaved2of5', vision: ['VNBarcodeSymbologyI2of5', 'VNBarcodeSymbologyI2of5Checksum', 'VNBarcodeSymbologyITF14'], quietLeft: 10, quietRight: 10, charset: /^[0-9]+$/, minLength: 4, maxLength: 40, evenLength: true },
  codabar: { id: 'codabar', name: 'Codabar', ...ONE_D, catima: 'CODABAR', camera: 'codabar', bwip: 'rationalizedCodabar', vision: ['VNBarcodeSymbologyCodabar'], quietLeft: 10, quietRight: 10, charset: /^[0-9A-D$:/.+-]+$/, minLength: 1, maxLength: 40 },
  code39: { id: 'code39', name: 'Code 39', ...ONE_D, catima: 'CODE_39', camera: 'code39', bwip: 'code39', vision: ['VNBarcodeSymbologyCode39', 'VNBarcodeSymbologyCode39Checksum', 'VNBarcodeSymbologyCode39FullASCII', 'VNBarcodeSymbologyCode39FullASCIIChecksum'], quietLeft: 10, quietRight: 10, charset: /^[0-9A-Z $%./+-]+$/, minLength: 1, maxLength: 48 },
  code93: { id: 'code93', name: 'Code 93', ...ONE_D, catima: 'CODE_93', camera: 'code93', bwip: 'code93', vision: ['VNBarcodeSymbologyCode93', 'VNBarcodeSymbologyCode93i'], quietLeft: 10, quietRight: 10, charset: /^[0-9A-Z $%./+-]+$/, minLength: 1, maxLength: 48 },
  qr: { id: 'qr', name: 'QR Code', ...TWO_D, catima: 'QR_CODE', camera: 'qr', bwip: 'qrcode', vision: ['VNBarcodeSymbologyQR'] },
  aztec: { id: 'aztec', name: 'Aztec', ...TWO_D, catima: 'AZTEC', camera: 'aztec', bwip: 'azteccode', vision: ['VNBarcodeSymbologyAztec'], quietLeft: 4, quietRight: 4 }, // 4, not 2: D46 (dim-contrast reads of large symbols)
  pdf417: { id: 'pdf417', name: 'PDF417', ...TWO_D, catima: 'PDF_417', camera: 'pdf417', bwip: 'pdf417', vision: ['VNBarcodeSymbologyPDF417'], quietLeft: 2, quietRight: 2 },
  datamatrix: { id: 'datamatrix', name: 'Data Matrix', ...TWO_D, catima: 'DATA_MATRIX', camera: 'datamatrix', bwip: 'datamatrix', vision: ['VNBarcodeSymbologyDataMatrix'], quietLeft: 2, quietRight: 2 },
};

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && (FORMAT_IDS as readonly string[]).includes(value);
}

/** Catima barcode type name → our id; unknown (MAXICODE, RSS_14, RSS_EXPANDED, …) → undefined. */
export function formatFromCatima(name: string | null | undefined): FormatId | undefined {
  if (!name) return undefined;
  const n = name.trim().toUpperCase();
  return FORMAT_IDS.find((id) => FORMATS[id].catima === n);
}

/** expo-camera / ML Kit / Vision / Catima / loose names ("EAN13", "Code 128", "upc-a", "ITF-14", "org.gs1.EAN-13") → our id. */
export function formatFromHint(hint: string | null | undefined): FormatId | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase().replace(/[^a-z0-9]/g, '');
  const table: Record<string, FormatId> = {
    code128: 'code128',
    ean13: 'ean13',
    ean8: 'ean8',
    upca: 'upca',
    upce: 'upce',
    itf: 'itf',
    itf14: 'itf',
    i2of5: 'itf',
    i2of5checksum: 'itf',
    interleaved2of5: 'itf',
    codabar: 'codabar',
    code39: 'code39',
    code39checksum: 'code39',
    code39fullascii: 'code39',
    code93: 'code93',
    code93i: 'code93',
    qr: 'qr',
    qrcode: 'qr',
    aztec: 'aztec',
    azteccode: 'aztec',
    pdf417: 'pdf417',
    datamatrix: 'datamatrix',
    none: 'none',
  };
  if (table[h]) return table[h];
  const stripped = h.replace(/^vnbarcodesymbology/, '').replace(/^orggs1/, '').replace(/^orgiso/, '').replace(/^comintermec/, '');
  if (table[stripped]) return table[stripped];
  for (const key of Object.keys(table).sort((a, b) => b.length - a.length)) if (h.endsWith(key)) return table[key];
  return undefined;
}
