// Render round-trip runner and SPEC §13 scorer, shared by `npm run referee` (dev set) and `npm run blind -- <set>` (blind
// sets). Pure TS apart from the two injected steps: `rasterize(jobs)` (referee/swift/rasterize.swift) and `decode(dir)`
// (referee/swift/decode.swift, macOS Vision). Scoring: exact string equality after the documented normalisation
// (UPC-A ↔ EAN-13 leading 0; Codabar start/stop letters; ITF-14 = ITF), per format × scale × contrast; "decoded as a
// different value" counted separately from "not decoded" (the dangerous one; target 0).
import { FORMATS, formatFromHint, isFormatId, type FormatId } from '@/engine/barcode/formats';
import { expandRows, renderMatrix, type Matrix } from '@/engine/barcode/render';
import { splitCodabar, validate } from '@/engine/barcode/validate';

export type SetEntry = { format: FormatId; value: string; expectDecoded?: string | null; note?: string; source?: string };
export type Contrast = { name: string; fg: string; bg: string };
export const SCALES = [2, 3, 4] as const;
export const CONTRASTS: readonly Contrast[] = [
  { name: 'bw', fg: '#000000', bg: '#ffffff' },
  { name: 'dim', fg: '#333333', bg: '#bbbbbb' },
];

export type Job = { out: string; modulePx: number; fg: string; bg: string; width: number; height: number; rows: string[] };
export type Decoded = Map<string, { value: string; symbology: string }[]>; // png path → results

/** Accepts the blind agents' documented keys only (format id or a loose name, value, expectDecoded, note); anything else is ignored. */
export function loadEntries(json: unknown, source: string): { entries: SetEntry[]; rejected: string[] } {
  const entries: SetEntry[] = [];
  const rejected: string[] = [];
  const list = Array.isArray(json) ? json : typeof json === 'object' && json !== null && Array.isArray((json as { entries?: unknown }).entries) ? (json as { entries: unknown[] }).entries : [];
  list.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return rejected.push(`${source}#${i}: not an object`);
    const r = raw as Record<string, unknown>;
    const format = isFormatId(r.format) ? r.format : formatFromHint(typeof r.format === 'string' ? r.format : undefined);
    if (!format || format === 'none') return rejected.push(`${source}#${i}: unknown format ${JSON.stringify(r.format)}`);
    if (typeof r.value !== 'string') return rejected.push(`${source}#${i}: value is not a string`);
    const expectDecoded = r.expectDecoded === undefined ? undefined : r.expectDecoded === null ? null : String(r.expectDecoded);
    entries.push({ format, value: r.value, expectDecoded, note: typeof r.note === 'string' ? r.note : undefined, source: `${source}#${i}` });
  });
  return { entries, rejected };
}

/** What Vision should report for a value, under the documented conventions. */
export function expectedDecode(format: FormatId, value: string): string {
  if (format === 'upca') return `0${value}`;
  if (format === 'codabar') return splitCodabar(value).body;
  return value;
}

/** Normalises a decoder result the same way (so both sides compare after the convention). */
export function normaliseDecoded(format: FormatId, decoded: string, symbology: string): string {
  if (format === 'codabar' || /codabar/i.test(symbology)) return splitCodabar(decoded).body;
  if (format === 'upca' && decoded.length === 12) return `0${decoded}`;
  return decoded;
}

/**
 * Review S9: the SAME conventions on both sides — an expectation written as `A1234B` or a 12-digit UPC-A must not score
 * "wrong value" when Vision reads `1234` / `0036000291452`. Codabar: when BOTH sides carry start/stop letters they are
 * compared too (a wrong letter stays wrong); Vision drops them, so with Vision only the body can be checked.
 */
export function sameDecoded(format: FormatId, expected: string, decoded: string, symbology: string): boolean {
  if (format === 'codabar' || /codabar/i.test(symbology)) {
    const e = splitCodabar(expected);
    const d = splitCodabar(decoded);
    if (e.start && e.stop && d.start && d.stop) return expected === decoded;
    return e.body === d.body;
  }
  if (format === 'upca') {
    const thirteen = (v: string) => (/^[0-9]{12}$/.test(v) ? `0${v}` : v);
    return thirteen(expected) === thirteen(decoded);
  }
  return expected === decoded;
}

export type Outcome = 'ok' | 'notDecoded' | 'wrongValue' | 'rejected' | 'renderError';
export type Result = { entry: SetEntry; scale: number; contrast: string; outcome: Outcome; got?: string; symbology?: string; expected: string | null };

export type Prepared = { entry: SetEntry; matrix?: Matrix; rejected?: string; renderError?: string; expected: string | null };

/** validate → render for every entry (once; scales and contrasts only change the rasterisation). */
export function prepare(entries: readonly SetEntry[]): Prepared[] {
  return entries.map((entry) => {
    const v = validate(entry.value, entry.format);
    // without a documented expectation, the CANONICAL value (trimmed/upper-cased by normalise) is what the code carries
    const expected = entry.expectDecoded === undefined ? expectedDecode(entry.format, v.ok ? v.value : entry.value) : entry.expectDecoded;
    if (!v.ok) return { entry, rejected: v.error, expected };
    try {
      return { entry, matrix: renderMatrix(v.value, entry.format), expected };
    } catch (e) {
      return { entry, renderError: e instanceof Error ? e.message : String(e), expected };
    }
  });
}

export function pngName(index: number, format: FormatId): string {
  return `${String(index).padStart(4, '0')}-${format}.png`;
}

/** Rasterise jobs for every prepared entry × scale × contrast under `outDir/<scale>px-<contrast>/`. */
export function jobsFor(prepared: readonly Prepared[], outDir: string, scales: readonly number[] = SCALES, contrasts: readonly Contrast[] = CONTRASTS): Job[] {
  const jobs: Job[] = [];
  prepared.forEach((p, i) => {
    if (!p.matrix) return;
    const rows = expandRows(p.matrix, p.matrix.kind === '1d' ? Math.max(p.matrix.modulesHigh, Math.ceil(p.matrix.modulesWide / 4)) : undefined);
    for (const s of scales) for (const c of contrasts) jobs.push({ out: `${outDir}/${s}px-${c.name}/${pngName(i, p.entry.format)}`, modulePx: s, fg: c.fg, bg: c.bg, width: p.matrix.modulesWide, height: rows.length, rows });
  });
  return jobs;
}

/** Scores decoder output against the prepared entries. */
export function score(prepared: readonly Prepared[], decoded: Decoded, outDir: string, scales: readonly number[] = SCALES, contrasts: readonly Contrast[] = CONTRASTS): Result[] {
  const results: Result[] = [];
  prepared.forEach((p, i) => {
    for (const s of scales)
      for (const c of contrasts) {
        const base = { entry: p.entry, scale: s, contrast: c.name, expected: p.expected };
        if (p.rejected) {
          // expectDecoded null = the set expects the engine to REFUSE the value: a rejection is then the right answer
          results.push({ ...base, outcome: p.expected === null ? 'ok' : 'rejected', got: p.rejected });
          continue;
        }
        if (!p.matrix) {
          results.push({ ...base, outcome: 'renderError', got: p.renderError });
          continue;
        }
        if (p.expected === null) {
          // the engine accepted a value the set says is invalid: dangerous whether or not the decoder reads it
          const read = (decoded.get(`${outDir}/${s}px-${c.name}/${pngName(i, p.entry.format)}`) ?? []).find((d) => d.value !== '');
          results.push({ ...base, outcome: 'wrongValue', got: read ? read.value : '(accepted an invalid value)', symbology: read?.symbology });
          continue;
        }
        const path = `${outDir}/${s}px-${c.name}/${pngName(i, p.entry.format)}`;
        const found = (decoded.get(path) ?? []).filter((d) => d.value !== '' || d.symbology !== '');
        if (found.length === 0) {
          results.push({ ...base, outcome: 'notDecoded' });
          continue;
        }
        const expectedFormat = FORMATS[p.entry.format];
        // prefer a result of the right symbology; a value from another symbology is still "wrong value" (a till would act on it)
        const hit = found.find((d) => expectedFormat.vision.includes(d.symbology) && sameDecoded(p.entry.format, p.expected!, d.value, d.symbology)) ?? found[0];
        const ok = sameDecoded(p.entry.format, p.expected, hit.value, hit.symbology);
        results.push({ ...base, outcome: ok ? 'ok' : 'wrongValue', got: hit.value, symbology: hit.symbology });
      }
  });
  return results;
}

export type Cell = { n: number; ok: number; notDecoded: number; wrongValue: number; rejected: number; renderError: number };

function cell(): Cell {
  return { n: 0, ok: 0, notDecoded: 0, wrongValue: 0, rejected: 0, renderError: 0 };
}

export function tally(results: readonly Result[]): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const r of results) {
    for (const key of [`${r.entry.format}|${r.scale}|${r.contrast}`, `all|${r.scale}|${r.contrast}`, `${r.entry.format}|*|*`, `all|*|*`]) {
      if (!m.has(key)) m.set(key, cell());
      const c = m.get(key)!;
      c.n++;
      c[r.outcome]++;
    }
  }
  return m;
}

const pct = (a: number, n: number) => (n === 0 ? '   -  ' : `${((100 * a) / n).toFixed(1).padStart(5)}%`);

/** The report: per format × scale × contrast table, the A2 gates, and the misses. */
export function formatReport(title: string, results: readonly Result[], opts: { misses?: boolean; evidence: boolean }): string {
  const t = tally(results);
  const formats = [...new Set(results.map((r) => r.entry.format))].sort();
  const lines: string[] = [title, ''];
  lines.push(`entries: ${new Set(results.map((r) => r.entry.source ?? r.entry.value)).size}  results: ${results.length}  ${opts.evidence ? 'BLIND SET — first run = evidence (L27)' : 'DEVELOPMENT SET — tuning only, not evidence'}`);
  lines.push('');
  lines.push('format        scale contrast     n     ok   not-decoded  WRONG  rejected render-err');
  for (const f of [...formats, 'all'])
    for (const s of SCALES)
      for (const c of CONTRASTS) {
        const x = t.get(`${f}|${s}|${c.name}`);
        if (!x) continue;
        lines.push(`${f.padEnd(13)} ${String(s).padStart(2)}px  ${c.name.padEnd(8)} ${String(x.n).padStart(5)} ${pct(x.ok, x.n)}  ${pct(x.notDecoded, x.n)}   ${String(x.wrongValue).padStart(5)}  ${String(x.rejected).padStart(8)} ${String(x.renderError).padStart(10)}`);
      }
  lines.push('');
  lines.push('A2 gates (SPEC §12): 3 px full contrast ≥ 99.5 % (1D + QR) / ≥ 99 % (Aztec, PDF417, Data Matrix); dim ≥ 97 %; wrong value = 0; 2 px reported, not gated');
  for (const f of formats) {
    const bw = t.get(`${f}|3|bw`);
    const dim = t.get(`${f}|3|dim`);
    const gate = f === 'aztec' || f === 'pdf417' || f === 'datamatrix' ? 99 : 99.5;
    const okBw = bw ? (100 * bw.ok) / Math.max(1, bw.n) : 0;
    const okDim = dim ? (100 * dim.ok) / Math.max(1, dim.n) : 0;
    const wrong = results.filter((r) => r.entry.format === f && r.outcome === 'wrongValue').length;
    lines.push(`  ${f.padEnd(12)} 3px bw ${okBw.toFixed(1).padStart(5)}% (gate ${gate}) ${okBw >= gate ? 'PASS' : 'MISS'} · 3px dim ${okDim.toFixed(1).padStart(5)}% (gate 97) ${okDim >= 97 ? 'PASS' : 'MISS'} · wrong ${wrong} ${wrong === 0 ? 'PASS' : 'MISS'}`);
  }
  const all = t.get('all|3|bw');
  const allDim = t.get('all|3|dim');
  const all2 = t.get('all|2|bw');
  lines.push('');
  lines.push(`overall 3px bw ${all ? pct(all.ok, all.n).trim() : '-'} · 3px dim ${allDim ? pct(allDim.ok, allDim.n).trim() : '-'} · 2px bw ${all2 ? pct(all2.ok, all2.n).trim() : '-'} · wrong values total ${results.filter((r) => r.outcome === 'wrongValue').length} · rejected by validate ${results.filter((r) => r.outcome === 'rejected').length / (SCALES.length * CONTRASTS.length)} entries`);
  if (opts.misses) {
    lines.push('', 'misses (first 200):');
    let n = 0;
    for (const r of results) {
      if (r.outcome === 'ok' || n >= 200) continue;
      n++;
      lines.push(`  ${r.entry.source ?? ''} ${r.entry.format} ${r.scale}px ${r.contrast} ${r.outcome}: value ${JSON.stringify(r.entry.value.slice(0, 60))} expected ${JSON.stringify(r.expected?.slice(0, 60) ?? null)} got ${JSON.stringify(r.got?.slice(0, 60) ?? '')} ${r.symbology ?? ''}${r.entry.note ? ` — ${r.entry.note}` : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}
