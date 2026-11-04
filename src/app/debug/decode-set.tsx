// Dev route (development variant only): <scheme>://debug/decode-set
// P5 R2-on-device (SPEC §13, review "ML Kit decoding"): the builder's DEVELOPMENT render set
// (test/fixtures/render/dev/render-dev.json, tuning only, never evidence) rendered ON THE DEVICE by our engine (Hermes) at
// 2/3/4 px × black-on-white and the dim proxy (#333 on #bbb), 1D bars ≥ 32 modules (D34, the card screen's layout floor),
// written as PNGs to the cache and decoded with code-kit (iOS Vision / Android ML Kit bundled). Scored with the referee's
// own rules (test/render-set.ts). Prints `R2 ok n/N wrong k` (testID r2-result); misses go to the Metro log as `R2`.
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MIN_BAR_MODULES } from '@/engine/barcode/layout';
import { toPng } from '@/engine/barcode/png';
import { useT } from '@/hooks/use-t';
import { testToolsEnabled } from '@/lib/variant';

import { detectBarcodes } from '../../../modules/code-kit';
import devSet from '../../../test/fixtures/render/dev/render-dev.json';
import { CONTRASTS, SCALES, loadEntries, pngName, prepare, score, type Decoded } from '../../../test/render-set';

const log = (line: string) => console.log(`R2 ${Platform.OS} ${line}`);
const grey = (hex: string) => parseInt(hex.slice(1, 3), 16);

type Summary = { key: string; ok: number; total: number; wrong: number; notDecoded: number };

export default function DecodeSetScreen() {
  const t = useT();
  const dev = testToolsEnabled();
  const [progress, setProgress] = useState('');
  const [rows, setRows] = useState<Summary[] | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!dev || started.current) return;
    started.current = true;
    (async () => {
      const t0 = performance.now();
      const { entries } = loadEntries(devSet, 'render-dev.json');
      const prepared = prepare(entries);
      const root = new Directory(Paths.cache, 'r2');
      root.create({ intermediates: true, idempotent: true });
      const decoded: Decoded = new Map();
      let n = 0;
      let decodeMs = 0;
      for (const s of SCALES)
        for (const c of CONTRASTS) {
          const dir = new Directory(root, `${s}px-${c.name}`);
          dir.create({ intermediates: true, idempotent: true });
          for (let i = 0; i < prepared.length; i++) {
            const m = prepared[i].matrix;
            if (!m) continue;
            const bars = m.kind === '1d' ? Math.max(m.modulesHigh, Math.ceil(m.modulesWide / 4), MIN_BAR_MODULES) : undefined;
            const { png } = toPng(m, { modulePx: s, barHeightPx: bars ? bars * s : undefined, fg: grey(c.fg), bg: grey(c.bg) });
            const name = pngName(i, prepared[i].entry.format);
            const file = new File(dir, name);
            file.write(png);
            const d0 = performance.now();
            let found: { value: string; format: string }[] = [];
            try {
              found = await detectBarcodes(file.uri);
            } catch (e) {
              log(`error ${name}: ${e instanceof Error ? e.message : String(e)}`); // scored as not decoded
            }
            decodeMs += performance.now() - d0;
            // ML Kit reports an EAN-13 with a leading 0 as UPC-A (12 digits); Vision the other way round. Same symbol, the SPEC §13
            // convention: compare as the 13-digit EAN form.
            decoded.set(`r2/${s}px-${c.name}/${name}`, found.map((f) => (f.format === 'upca' && /^[0-9]{12}$/.test(f.value) ? { value: `0${f.value}`, symbology: 'ean13' } : { value: f.value, symbology: f.format })));
            if (++n % 50 === 0) setProgress(`${n}`);
          }
        }
      const results = score(prepared, decoded, 'r2');
      const summaries: Summary[] = [];
      for (const s of SCALES)
        for (const c of CONTRASTS) {
          const r = results.filter((x) => x.scale === s && x.contrast === c.name);
          summaries.push({ key: `${s}px ${c.name}`, ok: r.filter((x) => x.outcome === 'ok').length, total: r.length, wrong: r.filter((x) => x.outcome === 'wrongValue').length, notDecoded: r.filter((x) => x.outcome === 'notDecoded').length });
        }
      for (const x of results.filter((r) => r.outcome !== 'ok'))
        log(`miss ${x.scale}px ${x.contrast} ${x.entry.format} ${JSON.stringify(x.entry.value).slice(0, 60)} ${x.outcome} got ${JSON.stringify(x.got ?? '').slice(0, 60)} ${x.symbology ?? ''}`);
      for (const x of summaries) log(`${x.key}: ${x.ok}/${x.total} wrong ${x.wrong} notDecoded ${x.notDecoded}`);
      const ok = results.filter((r) => r.outcome === 'ok').length;
      log(`total ${ok}/${results.length} wrong ${results.filter((r) => r.outcome === 'wrongValue').length} — ${n} PNGs, decode ${(decodeMs / n).toFixed(0)} ms each, run ${((performance.now() - t0) / 1000).toFixed(0)} s`);
      setRows(summaries);
    })().catch((e: Error) => {
      log(`crashed: ${e.message}`);
      setProgress(`crashed: ${e.message}`);
    });
  }, [dev]);

  if (!dev) return null;
  if (!rows) return <ThemedText testID="r2-running" style={{ padding: 16 }}>{`${t('debug.selfTestRunning')} ${progress}`}</ThemedText>;
  const ok = rows.reduce((a, r) => a + r.ok, 0);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const wrong = rows.reduce((a, r) => a + r.wrong, 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
      <ThemedText testID="r2-result">{`R2 ok ${ok}/${total} wrong ${wrong}`}</ThemedText>
      {rows.map((r) => (
        <ThemedText key={r.key} style={{ fontSize: 12 }}>{`${r.key}: ${r.ok}/${r.total} wrong ${r.wrong} not decoded ${r.notDecoded}`}</ThemedText>
      ))}
    </ScrollView>
  );
}
