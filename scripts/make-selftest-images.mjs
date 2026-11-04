#!/usr/bin/env node
// Writes the A6 self-test PNGs test/fixtures/images/<format>.png (13) + two-codes.png from src/dev/selftest-cases.ts,
// rendered by OUR engine (renderMatrix → modules) at 4 px per module, black on white. two-codes.png puts an EAN-13 above
// a QR on a 1080-px-wide white canvas (a phone-screenshot stand-in). The dev self-test decodes them with code-kit on the
// simulator/emulator (Vision / ML Kit). Usage: node --import ./scripts/node/ts-hooks.mjs scripts/make-selftest-images.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync } from 'fflate';

import { toPng } from '../src/engine/barcode/png.ts';
import { expandRows, renderMatrix } from '../src/engine/barcode/render.ts';
import { SELFTEST_IMAGES } from '../src/dev/selftest-cases.ts';

const dir = join(import.meta.dirname, '..', 'test', 'fixtures', 'images');
const PX = 4;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
/** Greyscale PNG from a w×h byte canvas. */
function grayPng(w, h, px) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** Draws a matrix at (x0, y0), PX per module; 1D bars get 30 % of the symbol width as height. */
function draw(canvas, w, m, x0, y0) {
  const rows = expandRows(m, m.kind === '1d' ? Math.ceil((m.modulesWide * 0.3)) : undefined);
  rows.forEach((row, ry) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '1') continue;
      for (let dy = 0; dy < PX; dy++) canvas.fill(0, (y0 + ry * PX + dy) * w + x0 + x * PX, (y0 + ry * PX + dy) * w + x0 + (x + 1) * PX);
    }
  });
  return rows.length * PX;
}

for (const img of SELFTEST_IMAGES) {
  if (img.codes.length === 1) {
    const { format, value } = img.codes[0];
    const m = renderMatrix(value, format);
    writeFileSync(join(dir, img.file), toPng(m, { modulePx: PX, barHeightPx: m.kind === '1d' ? Math.ceil(m.modulesWide * PX * 0.3) : undefined }).png);
  } else {
    const w = 1080;
    const h = 1600;
    const canvas = new Uint8Array(w * h).fill(255);
    let y = 120;
    for (const c of img.codes) {
      const m = renderMatrix(c.value, c.format);
      y += draw(canvas, w, m, Math.floor((w - m.modulesWide * PX) / 2), y) + 160;
    }
    writeFileSync(join(dir, img.file), grayPng(w, h, canvas));
  }
  console.log(img.file);
}
