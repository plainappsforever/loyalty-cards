// Photo bytes are checked by their markers, never decoded (pure TypeScript, no image library): a file name promises a
// type (Catima `card_<n>_<side>.png`, our backup `cards/<id>/front.jpg`), and the bytes must keep that promise (B2 CE-05,
// D37). Both ends are checked so a truncated file counts as broken.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x49, 0x45, 0x4e, 0x44]; // the type of the last chunk; followed by its 4-byte CRC

/** PNG signature at the start and the IEND chunk at the end. */
export function isPng(b: Uint8Array): boolean {
  if (b.length < PNG_SIGNATURE.length + 12) return false;
  if (PNG_SIGNATURE.some((x, i) => b[i] !== x)) return false;
  return IEND.every((x, i) => b[b.length - 8 + i] === x);
}

/** JPEG start-of-image marker (FF D8 FF) and an end-of-image marker (FF D9) at the end; trailing zero padding allowed. */
export function isJpeg(b: Uint8Array): boolean {
  if (b.length < 5 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return false;
  let end = b.length;
  while (end > 3 && b[end - 1] === 0) end--;
  return b[end - 2] === 0xff && b[end - 1] === 0xd9;
}
