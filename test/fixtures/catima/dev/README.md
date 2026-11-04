# Catima development fixtures (the builder's own — NOT the blind agent's)

- `sample-v2.zip` + `sample-v2.expected.json`: written by our writer (`scripts/make-catima-fixtures.mjs`) from 44 cards
  (every format, 15-language names, multi-line notes, colours, timestamps, groups) plus one duplicate row.
- `sample-v1.csv` + `sample-v1.expected.json`: hand-written pre-2.0 export with missing columns, quotes, a MAXICODE card,
  an empty name and an empty number row.
Round-trip tests: `src/engine/catima/fixtures.test.ts`. The blind agent's exports land in `../blind-1/` (P3b).
