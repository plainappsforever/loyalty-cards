/**
 * @jest-environment node
 */
// A1: the engine against the independent Python oracle (referee/python/validate_oracle.py → test/fixtures/oracle/validate.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FormatId } from './formats';
import { validate } from './validate';

type Case = { format: FormatId; value: string; ok: boolean; canonical?: string; error?: string; suggestion?: string };

describe('validation oracle (A1)', () => {
  it('agrees with the Python oracle on every generated case (0 mismatches)', () => {
    const cases: Case[] = JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/oracle/validate.json'), 'utf8'));
    expect(cases.length).toBeGreaterThan(30000);
    const perFamily = new Map<string, number>();
    const mismatches: string[] = [];
    for (const c of cases) {
      perFamily.set(c.format, (perFamily.get(c.format) ?? 0) + 1);
      const v = validate(c.value, c.format);
      const got = v.ok ? { ok: true, canonical: v.value } : { ok: false, error: v.error, suggestion: v.suggestion?.value };
      const want = c.ok ? { ok: true, canonical: c.canonical } : { ok: false, error: c.error, suggestion: c.suggestion };
      if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${c.format} ${JSON.stringify(c.value)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(mismatches).toHaveLength(0);
    for (const n of [perFamily.get('ean13')! + perFamily.get('upca')! + perFamily.get('ean8')!, perFamily.get('upce')!, perFamily.get('itf')!, perFamily.get('codabar')!, perFamily.get('code39')! + perFamily.get('code93')!, perFamily.get('code128')!, perFamily.get('qr')! + perFamily.get('aztec')! + perFamily.get('pdf417')! + perFamily.get('datamatrix')!]) expect(n).toBeGreaterThanOrEqual(5000);
  });
});
