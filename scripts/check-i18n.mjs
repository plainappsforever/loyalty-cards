#!/usr/bin/env node
// Fails when a UI language file differs from src/i18n/en.ts: a missing or extra key, an empty text, a {placeholder}
// missing or added, or the app name translated. Also checks that every file is registered in src/i18n/index.ts and
// reports how many of the languages in LANGUAGES have a file. Until P7 the 13 languages without a file fall back to
// English per key (SPEC §11, card-scanner D25); `--strict` (P7 switches `verify` to it) fails when any is missing.
// Pattern from Offscan / print-cost D90 / card-scanner. Part of `npm run verify`. Usage: node scripts/check-i18n.mjs [--strict]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'src', 'i18n');
const LINE = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*(\/\/.*)?$/;
const strict = process.argv.includes('--strict');

function load(file) {
  const entries = new Map();
  const odd = [];
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = LINE.exec(line);
      if (m) {
        if (entries.has(m[1])) odd.push(`line ${i + 1}: key "${m[1]}" twice`);
        entries.set(m[1], m[2].replace(/\\'/g, "'"));
      } else if (/^\s*'[^']+':/.test(line)) odd.push(`line ${i + 1}: not a one-line single-quoted entry`);
    });
  return { entries, odd };
}

// unique set: "{n} card|{n} cards" (singular|plural, en/de) has the same placeholders as "Cards: {n}"
const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join(' ');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'));
const index = readFileSync(join(dir, 'index.ts'), 'utf8');
const en = load('en.ts').entries;
const appName = en.get('app.name');
const errors = [];

for (const file of files) {
  const { entries, odd } = load(file);
  odd.forEach((o) => errors.push(`${file}: ${o}`));
  if (!index.includes(`from './${file.replace(/\.ts$/, '')}'`)) errors.push(`${file}: not imported in src/i18n/index.ts`);
  if (file === 'en.ts') continue;
  for (const [key, text] of en) {
    if (!entries.has(key)) {
      errors.push(`${file}: missing key "${key}"`);
      continue;
    }
    const value = entries.get(key);
    if (value.trim() === '') errors.push(`${file}: "${key}" is empty`);
    if (placeholders(value) !== placeholders(text)) errors.push(`${file}: "${key}" placeholders ${placeholders(value) || '(none)'} instead of ${placeholders(text) || '(none)'}`);
    if (text.includes(appName) && !value.includes(appName)) errors.push(`${file}: "${key}" must keep the name "${appName}"`);
  }
  for (const key of entries.keys()) if (!en.has(key)) errors.push(`${file}: extra key "${key}" (not in en.ts)`);
}

// Languages the app offers (LANGUAGES in index.ts) without a dictionary file: English fallback until P7.
const languages = (/LANGUAGES: readonly Language\[\] = \[([^\]]+)\]/.exec(index)?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? [];
const present = new Set(files.map((f) => f.replace(/\.ts$/, '')));
const missing = languages.filter((l) => !present.has(l));
if (missing.length && strict) errors.push(`languages without a file (English fallback): ${missing.join(', ')}`);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`check-i18n: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`check-i18n: ${files.length} of ${languages.length} language files complete, ${en.size} keys, OK${missing.length ? ` (English fallback: ${missing.join(', ')})` : ''}`);
