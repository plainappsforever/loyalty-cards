// Zip read/write on fflate (MIT, pure JS; works in Node, Jest and Hermes). Stored or deflated entries; no encryption
// (Catima's password-protected exports use zip4j AES — D29: not readable here, the UI says so).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type ZipEntries = Record<string, Uint8Array>;

const PK = [0x50, 0x4b, 0x03, 0x04];

/** True when the bytes start with a local file header (PK\x03\x04). An empty zip (PK\x05\x06) counts as a zip too. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === PK[0] && bytes[1] === PK[1] && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/**
 * 'encrypted' when ANY local file header carries the encryption flag (bit 0) or method 99 (AES per WinZip/zip4j).
 * Walks the local headers (sizes from the header; a data-descriptor entry ends the walk, which is fine for our
 * purpose: Catima/zip4j write sizes in the header). Review R2: the first entry alone was checked before.
 */
export function zipEncryption(bytes: Uint8Array): 'none' | 'encrypted' {
  let off = 0;
  while (off + 30 <= bytes.length && bytes[off] === 0x50 && bytes[off + 1] === 0x4b && bytes[off + 2] === 0x03 && bytes[off + 3] === 0x04) {
    const flag = u16(bytes, off + 6);
    const method = u16(bytes, off + 8);
    if (flag & 1 || method === 99) return 'encrypted';
    if (flag & 8) break; // sizes in a data descriptor: cannot skip reliably
    const compressed = u32(bytes, off + 18);
    const nameLen = u16(bytes, off + 26);
    const extraLen = u16(bytes, off + 28);
    off += 30 + nameLen + extraLen + compressed;
  }
  return 'none';
}

export const ZIP_ENCRYPTED = 'zip is password-protected';

export function readZip(bytes: Uint8Array): ZipEntries {
  if (zipEncryption(bytes) === 'encrypted') throw new Error(ZIP_ENCRYPTED);
  try {
    return unzipSync(bytes);
  } catch (e) {
    if (/encrypt/i.test(e instanceof Error ? e.message : String(e))) throw new Error(ZIP_ENCRYPTED);
    throw e;
  }
}

/** Writes entries in the given order; text entries deflated, `.png`/`.jpg` stored (already compressed). */
export function writeZip(entries: ZipEntries): Uint8Array {
  const data: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, bytes] of Object.entries(entries)) data[name] = [bytes, { level: /\.(png|jpe?g)$/i.test(name) ? 0 : 6 }];
  return zipSync(data);
}

export const utf8 = { encode: (s: string): Uint8Array => strToU8(s), decode: (b: Uint8Array): string => strFromU8(b) };
