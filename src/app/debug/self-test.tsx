// Dev self-test route (development variant only): <scheme>://debug/self-test
// P5 (SPEC §12 A3/A6/A7, review R10): decodes the 13 + 1 fixture PNGs (+ 1 report-only) with code-kit (Vision / ML Kit), round-trips the
// window brightness, checks normalize/fold/Intl.Collator against Node's answers, then times the A3 rows on Hermes.
// Prints `SELFTEST PASS n/n` (testID selftest-result; Maestro asserts it) and `A3 PASS n/n (worst … ms)` (testID
// a3-result); every line also goes to the Metro log prefixed `SELFTEST`, and the whole run to Documents/selftest-<os>.json.
import { fixtureFileUri } from '../../dev/fixture-file';
import * as Brightness from 'expo-brightness';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SELFTEST_IMAGES } from '@/dev/selftest-cases';
import { A3_BUDGET_MS, A3_ROWS, brightnessCheck, imageCheck, mark, summary, textChecks, timeRow, type Check, type Timing } from '@/dev/selftest';
import { useT } from '@/hooks/use-t';
import { testToolsEnabled } from '@/lib/variant';

import { detectBarcodes } from '../../../modules/code-kit';

// Static requires (Metro bundles them as assets); keys = SELFTEST_IMAGES[].file.
const FIXTURES: Record<string, number> = {
  'code128.png': require('../../../test/fixtures/images/code128.png'),
  'ean13.png': require('../../../test/fixtures/images/ean13.png'),
  'ean8.png': require('../../../test/fixtures/images/ean8.png'),
  'upca.png': require('../../../test/fixtures/images/upca.png'),
  'upce.png': require('../../../test/fixtures/images/upce.png'),
  'itf.png': require('../../../test/fixtures/images/itf.png'),
  'codabar.png': require('../../../test/fixtures/images/codabar.png'),
  'code39.png': require('../../../test/fixtures/images/code39.png'),
  'code93.png': require('../../../test/fixtures/images/code93.png'),
  'qr.png': require('../../../test/fixtures/images/qr.png'),
  'aztec.png': require('../../../test/fixtures/images/aztec.png'),
  'pdf417.png': require('../../../test/fixtures/images/pdf417.png'),
  'datamatrix.png': require('../../../test/fixtures/images/datamatrix.png'),
  'two-codes.png': require('../../../test/fixtures/images/two-codes.png'),
  'codabar-short.png': require('../../../test/fixtures/images/codabar-short.png'),
};

const log = (line: string) => console.log(`SELFTEST ${Platform.OS} ${line}`);

async function runChecks(onCheck: (c: Check) => void): Promise<void> {
  const push = (c: Check) => {
    log(`${mark(c)} ${c.name} — ${c.detail}`);
    onCheck(c);
  };
  for (const img of SELFTEST_IMAGES) {
    try {
      const found = await detectBarcodes(await fixtureFileUri(FIXTURES[img.file]));
      push(imageCheck(img, found));
    } catch (e) {
      push({ name: `A6 ${img.file}`, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  try {
    const before = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(1);
    const during = await Brightness.getBrightnessAsync();
    if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
    else await Brightness.setBrightnessAsync(before);
    const after = await Brightness.getBrightnessAsync();
    push(brightnessCheck(before, during, after, Platform.OS === 'ios' && !Device.isDevice));
  } catch (e) {
    push({ name: 'A7 brightness', ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
  for (const c of textChecks()) push(c);
}

export default function SelfTestScreen() {
  const t = useT();
  const dev = testToolsEnabled(); // development + preview only (P8a-2: self-test on Release); fails closed (D54)
  const [checks, setChecks] = useState<Check[]>([]);
  const [timings, setTimings] = useState<Timing[]>([]);
  const [phase, setPhase] = useState<'checks' | 'timing' | 'done'>('checks');
  const started = useRef(false);

  useEffect(() => {
    if (!dev || started.current) return;
    started.current = true;
    (async () => {
      const done: Check[] = [];
      await runChecks((c) => {
        done.push(c);
        setChecks([...done]);
      });
      log(summary(done));
      setPhase('timing');
      const rows: Timing[] = [];
      for (const [format, value, content] of A3_ROWS) {
        await new Promise((r) => setTimeout(r, 0)); // let the screen update between rows
        const row = timeRow(format, value, content, () => performance.now());
        rows.push(row);
        log(`A3 ${row.format} ${row.content} ${row.modules} median ${row.ms.toFixed(1)} ms max ${row.max.toFixed(1)} ms svg ${row.svgMs.toFixed(1)} ms ${row.ms <= A3_BUDGET_MS ? 'PASS' : 'MISS'}`);
        setTimings([...rows]);
      }
      // also as a file (no-dev bundles may not forward console.log to Metro): Documents/selftest-<os>.json
      new File(Paths.document, `selftest-${Platform.OS}.json`).write(JSON.stringify({ dev: __DEV__, checks: done, timings: rows }, null, 1));
      setPhase('done');
    })().catch((e: Error) => log(`crashed: ${e.message}`));
  }, [dev]);

  if (!dev) return null;
  const a3Pass = timings.filter((r) => r.ms <= A3_BUDGET_MS).length;
  const worst = timings.reduce((m, r) => Math.max(m, r.ms), 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
      {phase === 'checks' ? (
        <ThemedText testID="selftest-running">{t('debug.selfTestRunning')}</ThemedText>
      ) : (
        <ThemedText testID="selftest-result">{summary(checks)}</ThemedText>
      )}
      {phase === 'done' ? (
        <ThemedText testID="a3-result">{`A3 ${a3Pass === timings.length ? 'PASS' : 'MISS'} ${a3Pass}/${timings.length} (worst ${worst.toFixed(0)} ms)`}</ThemedText>
      ) : null}
      {checks.map((c) => (
        <ThemedText key={c.name} style={{ fontSize: 12 }}>{`${mark(c)} ${c.name} — ${c.detail}`}</ThemedText>
      ))}
      {timings.map((r) => (
        <ThemedText key={`${r.format}${r.content}`} style={{ fontSize: 12 }}>{`A3 ${r.format} ${r.content} ${r.ms.toFixed(0)} ms (max ${r.max.toFixed(0)})`}</ThemedText>
      ))}
    </ScrollView>
  );
}
