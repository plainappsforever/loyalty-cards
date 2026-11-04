#!/usr/bin/env python3
"""P7: writes src/i18n/<lang>.ts from a key<TAB>text file, in the key order of src/i18n/en.ts, with the machine-draft
header. Fails when a key is missing or extra (check-i18n.mjs then checks placeholders and the app name).
Usage: python3 scripts/i18n-from-tsv.py <lang> <file.tsv> "<language name in English>"
The TSV files of the 2026-10-26 machine draft live in docs/i18n-draft/ (kept so a reviewer can diff a corrected file)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
lang, tsv, name = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
keys = re.findall(r"^\s*'([^']+)':", (ROOT / 'src/i18n/en.ts').read_text(encoding='utf-8'), re.M)
texts = {}
for line_no, line in enumerate(tsv.read_text(encoding='utf-8').splitlines(), 1):
    if not line.strip() or line.startswith('#'):
        continue
    key, sep, text = line.partition('\t')
    if not sep:
        sys.exit(f'{tsv}:{line_no}: no TAB in line')
    if key in texts:
        sys.exit(f'{tsv}:{line_no}: key {key} twice')
    texts[key] = text.strip()
missing = [k for k in keys if k not in texts]
extra = [k for k in texts if k not in keys]
if missing or extra:
    sys.exit(f'{lang}: missing {missing} extra {extra}')

ident = lang.replace('-', '')
quote = lambda s: "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"
out = [
    f'// {name} UI texts — MACHINE DRAFT (P7, 2026-10-26): translated from en.ts by the build agent, NOT reviewed by a',
    '// native speaker. Same keys and {placeholders} as en.ts (scripts/check-i18n.mjs). Counts are written "Label: {n}"',
    '// (no singular|plural pair outside en/de). Source: docs/i18n-draft/' + tsv.name + ' via scripts/i18n-from-tsv.py.',
    "import type { MessageKey } from './en';",
    '',
    f'export const {ident}: Record<MessageKey, string> = {{',
]
for k in keys:
    out.append(f'  {quote(k)}: {quote(texts[k])},')
out += ['};', '']
(ROOT / 'src/i18n' / f'{lang}.ts').write_text('\n'.join(out), encoding='utf-8')
print(f'{lang}: {len(keys)} keys written')
