#!/usr/bin/env node
// Blind render set measurement (SPEC §13, L27): renders every entry of test/fixtures/render/<set>/*.json with the engine
// as committed, rasterises at 2/3/4 px × 2 contrasts, decodes with macOS Vision, scores per format/scale/contrast with
// "wrong value" separate. The FIRST run of a set writes docs/<set>-first-run.txt (the evidence); later runs go to
// artifacts/ only and say so. Usage: npm run blind -- <set> [--misses]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatReport, jobsFor, loadEntries, prepare, score, SCALES, CONTRASTS } from '../test/render-set.ts';
import { decode, rasterize, root } from './render-tools.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const misses = process.argv.includes('--misses');
const set = args[0];
if (!set) {
  console.error('usage: npm run blind -- <set-folder-name under test/fixtures/render/> [--misses]');
  process.exit(2);
}
const dir = join(root, 'test/fixtures/render', set);
if (!existsSync(dir)) {
  console.error(`no such set: ${dir}`);
  process.exit(2);
}
const entries = [];
const rejected = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const r = loadEntries(JSON.parse(readFileSync(join(dir, f), 'utf8')), f);
  entries.push(...r.entries);
  rejected.push(...r.rejected);
}
console.log(`${set}: ${entries.length} entries from ${dir}${rejected.length ? `; ${rejected.length} ignored (unknown keys/format): ${rejected.slice(0, 3).join('; ')}` : ''}`);
const prepared = prepare(entries);
const out = join(root, 'artifacts', 'blind', set);
mkdirSync(out, { recursive: true });
console.log(rasterize(jobsFor(prepared, join(out, 'png')), join(out, 'jobs.json')));
const decoded = decode(SCALES.flatMap((s) => CONTRASTS.map((c) => join(out, 'png', `${s}px-${c.name}`))));
const results = score(prepared, decoded, join(out, 'png'));
const firstRun = join(root, 'docs', `${set}-first-run.txt`);
const first = !existsSync(firstRun);
let head;
try {
  head = (await import('node:child_process')).execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  head = 'unknown';
}
const title = `Blind set ${set} — ${first ? 'FIRST RUN (evidence)' : 'RE-RUN (the set is a tuning set now; not evidence)'} — engine commit ${head} — ${new Date().toISOString().slice(0, 16)}`;
const report = formatReport(title, results, { misses: true, evidence: first });
writeFileSync(join(out, 'report.txt'), report);
if (first) {
  writeFileSync(firstRun, report);
  console.log(`first run saved to docs/${set}-first-run.txt`);
} else console.log(`docs/${set}-first-run.txt exists — this run is NOT evidence; report in artifacts/blind/${set}/report.txt`);
console.log(misses ? report : report.split('\nmisses')[0]);
