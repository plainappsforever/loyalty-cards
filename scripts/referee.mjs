#!/usr/bin/env node
// Referees, device-free (SPEC §13; NOT evidence — the blind sets are):
//  R3 validation oracle: the engine against test/fixtures/oracle/validate.json (A1, written by referee/python/validate_oracle.py)
//  A3 render time in Node at the maximum length per format
//  R1 Mac Vision over the DEVELOPMENT render set test/fixtures/render/dev/ at 2/3/4 px × 2 contrasts
// Output under artifacts/referee/ (git-ignored). Exit 1 when the oracle disagrees or a dev-set code decodes to a WRONG value.
// Usage: node --import ./scripts/node/ts-hooks.mjs scripts/referee.mjs [--misses]   (npm run referee)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FORMAT_IDS, FORMATS } from '../src/engine/barcode/formats.ts';
import { clearEncodeCache } from '../src/engine/barcode/encode.ts';
import { renderMatrix } from '../src/engine/barcode/render.ts';
import { validate } from '../src/engine/barcode/validate.ts';
import { formatReport, jobsFor, loadEntries, prepare, score, SCALES, CONTRASTS } from '../test/render-set.ts';
import { decode, rasterize, root } from './render-tools.mjs';

const misses = process.argv.includes('--misses');
const out = join(root, 'artifacts', 'referee');
mkdirSync(out, { recursive: true });
let failures = 0;

// R3 — oracle
const cases = JSON.parse(readFileSync(join(root, 'test/fixtures/oracle/validate.json'), 'utf8'));
let mismatches = 0;
for (const c of cases) {
  const v = validate(c.value, c.format);
  const got = v.ok ? { ok: true, canonical: v.value } : { ok: false, error: v.error, suggestion: v.suggestion?.value };
  const want = c.ok ? { ok: true, canonical: c.canonical } : { ok: false, error: c.error, suggestion: c.suggestion };
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    mismatches++;
    if (mismatches <= 5) console.log(`ORACLE MISMATCH ${c.format} ${JSON.stringify(c.value)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
console.log(`R3 oracle: ${cases.length} cases, ${mismatches} mismatch(es)${mismatches ? ' — FAIL' : ''}`);
if (mismatches) failures++;

// A3 — render time per format (median of 5 after a warm-up). Each timed call starts with an EMPTY encode cache, so it is
// a first render including validate() (which may trial-encode 2D values, D32). Rows: the maximum length per format,
// plus HARD content (review S10: multi-byte text and punctuation mixes cost far more than 'x' × 1000).
const MAX = {
  code128: 'x'.repeat(80), ean13: '4006381333931', ean8: '96385074', upca: '036000291452', upce: '01234565', itf: '1'.repeat(40),
  codabar: 'A' + '7'.repeat(38) + 'B', code39: 'X'.repeat(48), code93: 'X'.repeat(48), qr: 'x'.repeat(1000), aztec: 'x'.repeat(1000), pdf417: 'x'.repeat(1000), datamatrix: 'x'.repeat(1000),
};
const HARD = [
  ['qr', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
  ['qr', '日'.repeat(700), '日×700'],
  ['aztec', '日'.repeat(500), '日×500'],
  ['aztec', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
  ['pdf417', 'ü'.repeat(500), 'ü×500'],
  ['pdf417', 'aB3$%&()'.repeat(110), "'aB3$%&()'×110"],
  ['datamatrix', '日'.repeat(500), '日×500'],
  ['datamatrix', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
];
const rowsToTime = [...FORMAT_IDS.filter((f) => f !== 'none').map((f) => [f, MAX[f], `max ${MAX[f].length}`]), ...HARD];
const timing = [];
for (const [f, value, label] of rowsToTime) {
  clearEncodeCache();
  renderMatrix(value, f);
  const times = [];
  let m;
  for (let i = 0; i < 5; i++) {
    clearEncodeCache();
    const t0 = performance.now();
    m = renderMatrix(value, f);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  timing.push({ format: f, content: label, length: [...value].length, modules: `${m.modulesWide}x${m.modulesHigh}`, ms: times[2], max: times[4] });
}
console.log('A3 render time in Node (median of 5, empty encode cache, validate included):');
for (const t of timing) console.log(`  ${t.format.padEnd(11)} ${t.content.padEnd(16)} ${String(t.length).padStart(4)} chars ${t.modules.padEnd(10)} ${t.ms.toFixed(1).padStart(6)} ms (max ${t.max.toFixed(1)} ms) ${t.ms <= 150 ? 'PASS' : 'MISS'}`);
writeFileSync(join(out, 'a3-timing.json'), JSON.stringify(timing, null, 1));
if (timing.some((t) => t.ms > 150)) failures++;

// R1 — dev set through rasterize + Vision
const devDir = join(root, 'test/fixtures/render/dev');
const { entries, rejected } = loadEntries(JSON.parse(readFileSync(join(devDir, 'render-dev.json'), 'utf8')), 'render-dev.json');
if (rejected.length) console.log(`dev set: ${rejected.length} entries ignored: ${rejected.slice(0, 3).join('; ')}`);
const prepared = prepare(entries);
const imgDir = join(out, 'dev');
console.log(rasterize(jobsFor(prepared, imgDir), join(out, 'dev-jobs.json')));
const decoded = decode(SCALES.flatMap((s) => CONTRASTS.map((c) => join(imgDir, `${s}px-${c.name}`))));
const results = score(prepared, decoded, imgDir);
const report = formatReport(`R1 — development render set (${new Date().toISOString().slice(0, 16)})`, results, { misses: true, evidence: false });
writeFileSync(join(out, 'dev-report.txt'), report);
console.log(misses ? report : report.split('\nmisses')[0]);
const wrong = results.filter((r) => r.outcome === 'wrongValue').length;
if (wrong) {
  console.log(`R1: ${wrong} WRONG VALUE result(s) — FAIL`);
  failures++;
}
for (const f of Object.keys(FORMATS)) if (f !== 'none' && !entries.some((e) => e.format === f)) console.log(`dev set has no ${f} entries`);
console.log(failures ? `referee: ${failures} failure(s)` : 'referee: OK');
process.exit(failures ? 1 : 0);
