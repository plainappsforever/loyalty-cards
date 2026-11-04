// A model of what Catima's importer refuses, written from its source (CatimaLoyalty/Android, commit 07b385d,
// app/src/main/java/protect/card_locker/importexport/CatimaImporter.java; read 2026-10-16, nothing copied — GPL-3.0).
// Used by tests to prove our Catima export is importable (review M5). Its own RFC 4180 reader (not csv-core.ts), so a
// quoting bug in our writer cannot hide behind the same parser.
//   L79-87   zip entries: `catima.csv` (last path segment), `card_<n>_<front|back|icon>.png`, anything else → abort
//   L222     v2 sections are split on EMPTY physical lines (a failed parse retries with the next lines appended)
//   L398     `_id` Integer.parseInt          L402  empty `store` → abort       L435 `balance` new BigDecimal (else 0)
//   L443     `balancetype` Currency.getInstance (unchecked exception → whole import aborted)
//   L448     empty `cardid` → abort          L459  `barcodetype` CatimaBarcode.fromName = ZXing enum valueOf
//   L468     `barcodeencoding` Charset.forName          L538/L553 group / link without a group id → abort
import { unzipSync, strFromU8 } from 'fflate';

const ZXING = ['AZTEC', 'CODABAR', 'CODE_39', 'CODE_93', 'CODE_128', 'DATA_MATRIX', 'EAN_8', 'EAN_13', 'ITF', 'MAXICODE', 'PDF_417', 'QR_CODE', 'RSS_14', 'RSS_EXPANDED', 'UPC_A', 'UPC_E', 'UPC_EAN_EXTENSION'];
const CHARSETS = ['UTF-8', 'ISO-8859-1', 'US-ASCII', 'UTF-16', 'UTF-16BE', 'UTF-16LE'];
const BIG_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const JAVA_INT = /^[+-]?\d{1,10}$/;

/** RFC 4180 records of one text block. */
function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('unterminated quote');
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Splits like L222: blank physical lines end a section unless the section does not parse yet (multi-line field). */
function sections(csv: string): string[][][] {
  const lines = csv.split(/\r?\n/);
  const out: string[][][] = [];
  let buf: string[] = [];
  const flush = (force: boolean) => {
    if (buf.length === 0) return true;
    try {
      out.push(records(buf.join('\n')));
      buf = [];
      return true;
    } catch (e) {
      if (force) throw e;
      return false;
    }
  };
  for (const line of lines) {
    if (line === '') {
      if (!flush(false)) buf.push(line);
    } else buf.push(line);
  }
  flush(true);
  return out;
}

/** Every reason Catima would abort the import of this zip (or lose a value silently); [] = Catima imports it. */
export function catimaImportProblems(zip: Uint8Array): string[] {
  const problems: string[] = [];
  const icu = new Set((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('currency'));
  let csv: string | null = null;
  for (const [path, bytes] of Object.entries(unzipSync(zip))) {
    const name = path.split('/').pop() ?? '';
    if (name === 'catima.csv') csv = strFromU8(bytes);
    else if (name.endsWith('.png')) {
      if (!/^(card_)(\d+)(_(?:front|back|icon)\.png)$/.test(name)) problems.push(`L83 unexpected PNG ${name}`);
    } else problems.push(`L87 unexpected file ${name}`);
  }
  if (csv === null) return [...problems, 'L100 no imported data'];
  const [version, groups, cards, links] = sections(csv);
  if (!version || version[0]?.[0] !== '2') problems.push('version line is not 2');
  for (const g of (groups ?? []).slice(1)) if ((g[0] ?? '') === '') problems.push('L538 group without id');
  const header = cards?.[0] ?? [];
  const at = (r: string[], k: string) => (header.indexOf(k) >= 0 ? (r[header.indexOf(k)] ?? '') : '');
  for (const r of (cards ?? []).slice(1)) {
    const id = at(r, '_id');
    if (!JAVA_INT.test(id)) problems.push(`L398 _id ${JSON.stringify(id)}`);
    if (at(r, 'store') === '') problems.push(`L402 card ${id}: empty store`);
    const balance = at(r, 'balance');
    if (balance !== '' && !BIG_DECIMAL.test(balance)) problems.push(`L435 card ${id}: balance ${JSON.stringify(balance)} becomes 0`);
    const type = at(r, 'balancetype');
    if (type !== '' && !icu.has(type)) problems.push(`L443 card ${id}: balancetype ${type} aborts the import`);
    if (at(r, 'cardid') === '') problems.push(`L448 card ${id}: empty cardid aborts the import`);
    const bt = at(r, 'barcodetype');
    if (bt !== '' && !ZXING.includes(bt)) problems.push(`L459 card ${id}: barcodetype ${bt}`);
    const enc = at(r, 'barcodeencoding');
    if (enc !== '' && !CHARSETS.includes(enc)) problems.push(`L468 card ${id}: barcodeencoding ${enc}`);
  }
  for (const l of (links ?? []).slice(1)) {
    if (!JAVA_INT.test(l[0] ?? '')) problems.push(`L547 link card id ${JSON.stringify(l[0])}`);
    if ((l[1] ?? '') === '') problems.push('L553 link without group id');
  }
  return problems;
}
