// Dev self-test logic (P5, SPEC §12 A3/A6/A7, review R10) — runs on the device (Hermes) from src/app/debug/self-test.tsx
// and in Jest (Node) with fakes. Every check is a { name, ok, detail } line; the screen prints `SELFTEST PASS n/n`.
// A3 timing rows are the referee's (scripts/referee.mjs MAX + HARD, review S10): median of 5 after a warm-up, each call
// with an EMPTY encode cache, validate() included (renderMatrix validates) + the SVG string the card screen draws.
import { clearEncodeCache } from '@/engine/barcode/encode';
import { FORMAT_IDS, formatFromHint, type FormatId } from '@/engine/barcode/formats';
import { renderMatrix } from '@/engine/barcode/render';
import { toSvg } from '@/engine/barcode/svg';
import { fold } from '@/engine/chains';
import { foldText } from '@/engine/search';
import { NAME_COLLATION } from '@/engine/sort';

import { sameDecoded, expectedDecode } from '../../test/render-set';
import { HERMES_TEXT_CASES, type SelfTestImage } from './selftest-cases';

/** `skipped`: the platform cannot show it here (iOS simulator brightness is fixed at 0.5); never counted as a pass. */
export type Check = { name: string; ok: boolean; detail: string; skipped?: boolean; reportOnly?: boolean };
export type Detected = { value: string; format: string };

export const A3_BUDGET_MS = 300;
const MAX: Record<Exclude<FormatId, 'none'>, string> = {
  code128: 'x'.repeat(80), ean13: '4006381333931', ean8: '96385074', upca: '036000291452', upce: '01234565', itf: '1'.repeat(40),
  codabar: 'A' + '7'.repeat(38) + 'B', code39: 'X'.repeat(48), code93: 'X'.repeat(48), qr: 'x'.repeat(1000), aztec: 'x'.repeat(1000), pdf417: 'x'.repeat(1000), datamatrix: 'x'.repeat(1000),
};
const HARD: [FormatId, string, string][] = [
  ['qr', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
  ['qr', '日'.repeat(700), '日×700'],
  ['aztec', '日'.repeat(500), '日×500'],
  ['aztec', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
  ['pdf417', 'ü'.repeat(500), 'ü×500'],
  ['pdf417', 'aB3$%&()'.repeat(110), "'aB3$%&()'×110"],
  ['datamatrix', '日'.repeat(500), '日×500'],
  ['datamatrix', 'aB3$%&()'.repeat(125), "'aB3$%&()'×125"],
];
export const A3_ROWS: [FormatId, string, string][] = [
  ...FORMAT_IDS.filter((f): f is Exclude<FormatId, 'none'> => f !== 'none').map((f): [FormatId, string, string] => [f, MAX[f], `max ${MAX[f].length}`]),
  ...HARD,
];

export type Timing = { format: FormatId; content: string; modules: string; ms: number; max: number; svgMs: number };

/** One A3 row: median and max of 5 timed first renders (validate + matrix), plus the median SVG-string time. */
export function timeRow(format: FormatId, value: string, content: string, now: () => number): Timing {
  clearEncodeCache();
  renderMatrix(value, format); // warm-up (JIT/lazy compilation), as the referee does
  const times: number[] = [];
  const svgTimes: number[] = [];
  let m = renderMatrix(value, format);
  for (let i = 0; i < 5; i++) {
    clearEncodeCache();
    const t0 = now();
    m = renderMatrix(value, format);
    const t1 = now();
    toSvg(m, { modulePx: 3 });
    svgTimes.push(now() - t1);
    times.push(t1 - t0);
  }
  times.sort((a, b) => a - b);
  svgTimes.sort((a, b) => a - b);
  return { format, content, modules: `${m.modulesWide}x${m.modulesHigh}`, ms: times[2], max: times[4], svgMs: svgTimes[2] };
}

/** R10: normalize('NFD'), the Latin-diacritic strip, toLowerCase and Intl.Collator give Node's answers. */
export function textChecks(): Check[] {
  const out: Check[] = [];
  for (const [input, want] of HERMES_TEXT_CASES.foldText) {
    const got = foldText(input);
    out.push({ name: `foldText ${input}`, ok: got === want, detail: JSON.stringify(got) });
  }
  for (const [input, want] of HERMES_TEXT_CASES.fold) {
    const got = fold(input);
    out.push({ name: `fold ${input}`, ok: got === want, detail: JSON.stringify(got) });
  }
  for (const [locale, a, b, sign] of HERMES_TEXT_CASES.collate) {
    const got = Math.sign(new Intl.Collator(locale, NAME_COLLATION).compare(a, b));
    out.push({ name: `collate ${locale} ${a}|${b}`, ok: got === sign, detail: String(got) });
  }
  return out;
}

/** The format a decoder reported, as our id. UPC-A read as EAN-13 with a leading 0 counts as UPC-A (Vision convention). */
export function sameFormat(expected: FormatId, reported: string, value: string): boolean {
  const id = formatFromHint(reported);
  if (id === expected) return true;
  return expected === 'upca' && id === 'ean13' && value.length === 13 && value.startsWith('0');
}

/** A6: every code of the image found with the right value and format (order-free; extra codes are not a failure). */
export function imageCheck(img: SelfTestImage, found: readonly Detected[]): Check {
  const missing = img.codes.filter(
    (c) => !found.some((d) => sameFormat(c.format, d.format, d.value) && sameDecoded(c.format, expectedDecode(c.format, c.value), d.value, d.format)),
  );
  const detail = found.map((d) => `${d.format}:${d.value}`).join(' | ') || '(nothing decoded)';
  return { name: `A6 ${img.file}`, ok: missing.length === 0, detail: img.reportOnly ? `${detail} [report only: ${img.reportOnly}]` : detail, ...(img.reportOnly ? { reportOnly: true } : {}) };
}

/** A7: brightness set to 1 reads back as 1, and the restore brings the value back (iOS: the remembered value). */
export function brightnessCheck(before: number, during: number, after: number, iosSimulator = false): Check {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  const detail = `before ${before.toFixed(3)} during ${during.toFixed(3)} after ${after.toFixed(3)}`;
  // The iOS simulator reports UIScreen brightness 0.5 whatever is set (P5 measurement): nothing to verify there.
  if (iosSimulator && near(before, 0.5) && near(during, 0.5) && near(after, 0.5)) return { name: 'A7 brightness 1.0 then restore', ok: false, skipped: true, detail: `${detail} (iOS simulator: brightness fixed)` };
  return { name: 'A7 brightness 1.0 then restore', ok: near(during, 1) && near(after, before), detail };
}

/** `SELFTEST PASS n/n` over the counted checks; skipped and report-only ones are listed, never counted as passed. */
export function summary(checks: readonly Check[]): string {
  const ran = checks.filter((c) => !c.skipped && !c.reportOnly);
  const passed = ran.filter((c) => c.ok).length;
  const skipped = checks.filter((c) => c.skipped).length;
  const reported = checks.filter((c) => c.reportOnly);
  const notes = [skipped ? `${skipped} skipped` : '', reported.length ? `report-only ${reported.filter((c) => c.ok).length}/${reported.length}` : ''].filter(Boolean).join(', ');
  return `SELFTEST ${passed === ran.length && ran.length > 0 ? 'PASS' : 'FAIL'} ${passed}/${ran.length}${notes ? ` (${notes})` : ''}`;
}

/** Line prefix for the screen and the log. */
export const mark = (c: Check): string => (c.skipped ? 'SKIP' : c.reportOnly ? (c.ok ? 'info ok' : 'info miss') : c.ok ? 'ok' : 'FAIL');
