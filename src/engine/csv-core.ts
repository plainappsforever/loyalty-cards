// RFC 4180 CSV parser and writer (pure; no dependency). Handles quoted fields with embedded delimiters, quotes ("" escapes)
// and line breaks, CRLF/LF/CR records, a UTF-8 BOM, and a configurable delimiter. Used by the Catima reader/writer,
// the generic CSV import/export and the referees.

export type CsvOptions = { delimiter?: string };

/** Parses `text` into records (arrays of fields). A trailing line break does not create an empty record. */
export function parseCsv(text: string, opts: CsvOptions = {}): string[][] {
  const d = opts.delimiter ?? ',';
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = src.length;
  let fieldStarted = false;
  while (i < n) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      fieldStarted = false;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    fieldStarted = true;
    i++;
  }
  if (fieldStarted || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Quotes a field when it contains the delimiter, a quote, a line break, or leading/trailing spaces. */
export function csvField(value: string, delimiter = ','): string {
  const s = String(value ?? '');
  return s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Writes records with CRLF line ends (RFC 4180; what Catima's Commons CSV writer produces). */
export function writeCsv(rows: readonly (readonly string[])[], opts: CsvOptions & { eol?: string } = {}): string {
  const d = opts.delimiter ?? ',';
  const eol = opts.eol ?? '\r\n';
  return rows.map((r) => r.map((f) => csvField(f, d)).join(d)).join(eol) + eol;
}

/** Picks the delimiter of a header line: the one of `,` `;` `\t` that splits it into the most fields (ties → `,`). */
export function detectDelimiter(firstLine: string): string {
  let best = ',';
  let count = -1;
  for (const d of [',', ';', '\t']) {
    const n = parseCsv(firstLine, { delimiter: d })[0]?.length ?? 0;
    if (n > count) {
      best = d;
      count = n;
    }
  }
  return best;
}
