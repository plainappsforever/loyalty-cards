# Blind set B1 — loyalty card wallet (`loyalty-cards`)

Written 2026-10-16 by a separate agent under WORKFLOW L27 (blind-set protocol + amendment). The author read ONLY
`docs/SPEC.md`, `docs/V1_PLAN.md`, `docs/DECISIONS.md` (D11–D31) and `docs/RESEARCH.md` of the app, plus Catima's public
`EXPORT_FORMAT.md`, `CARD_FIELDS.md` and `CARD_SHARING_URL_FORMAT.md` (facts copied by hand). The app's `src/` and
`test/` were never opened. Durable home: this folder (`/Volumes/Zweite/claude/blind-sets/loyalty-b1/`), never the
scratchpad. Protocol for the builder: commit the engine snapshot first, copy this folder verbatim, run ONCE, report the
figure; after any fix this set is a tuning set and B2 must come from another agent.

## 1. What is in the set

| File | Content |
|---|---|
| `render-cases.json` | **320 render values** for SPEC A2 (all 13 formats, 20–32 each, 54 adversarial): `{id, format, value, expectDecoded, expectSymbology, expectDecodedPattern?, adversarial?, note}` |
| `cases.json` | **198 cases** (188 scored + 10 ambiguous, 94 adversarial): validation, suggestions, UPC-E expansion, Catima colours / links / import / export, LC1 share payload, backup, generic CSV. `{id, kind, input, expect, strength, adversarial?, note}` |
| `fixtures/catima/` | 9 hand-written Catima zips/CSVs (v2 full A4 fixture, A13 12/2/1 fixture, pre-2.0 bare CSV, BOM+CRLF CSV, no-csv zip, AES-encrypted zip, group-case, 2,100 cards, same-number) + 1 informational |
| `fixtures/csv/`, `fixtures/backup/`, `fixtures/images/tiny.jpg` | generic CSVs (comma/semicolon/tab+BOM+CRLF/quoted/…); own-backup zips (valid, row skips, refusals); a 776-byte JPEG made with macOS `sips` |
| `oracle.py` | independent oracle, Python 3 standard library only |
| `score.py` | scorer (`cases` and `render` modes) |
| `selftest.py` | self-test; `--vision` adds own-rendered symbols decoded by Vision + 24 convention proofs |
| `build_set.py` | the hand-specified tables that wrote the JSON and fixtures (deterministic; rebuild = identical hashes) |
| `decode.swift` | referee: macOS Vision `VNDetectBarcodesRequest`, all symbologies, JSON lines out |
| `refrender.py`, `probe.swift`, `dmprobe.py` | the author's OWN encoders (1D tables; CoreImage QR/Aztec/PDF417; a minimal Data Matrix ECC200 with ECI) — used only to prove the conventions, never evidence about the engine |

`strength`: **firm** = stated in SPEC/DECISIONS/Catima docs/the symbology standard; **inferred** = follows from a spec
promise (e.g. §2 "never render a code no scanner accepts", D26 case-insensitive categories) but the exact rule is not
written — scored, reported separately; **ambiguous** = spec silent — NOT scored, the engine's behaviour is printed.

### Coverage

| Area | Cases (firm / inferred / ambiguous) | Adversarial | What is covered |
|---|---|---|---|
| (a) validate | 97 (69 / 25 / 3) | 39 | EAN-13 14, EAN-8 6, UPC-A 5, UPC-E 8, ITF 8, Codabar 11, Code 39 10, Code 93 5, Code 128 12, QR 8, Aztec 2, PDF417 3, Data Matrix 3, none 2: valid, every wrong-check case with the suggested digit, 12-digit EAN (check SHOWN, never appended), wrong lengths, leading zeros kept, full-width / Arabic-Indic digits, spreadsheet `.0`/exponent artefacts, JS-trim whitespace (BOM, NBSP, U+3000, newline), UPC-E number system / 6-digit form, ITF odd → "add a leading 0?" suggestion and < 4, Codabar start/stop (lower case, missing stop, E/T/N, letter in body, D30 body < 2), Code 39/93 charset incl. Unicode upper-case traps (ß→SS, ı→I, ﬁ→FI), Code 128 1–80 after trim, control chars, DEL, `^FNC1` as data, 2D 1,000/1,001 chars and byte capacity (1,000 × ü fits QR only; 1,000 × 日 fits nothing) |
| (a) suggestFormats | 13 (9 / 3 / 1) | 4 | first entry, membership, the pairs §5.1 orders (ean8 before upce for twins, code128 before itf), scanner hint first |
| (a) UPC-E expansion | 6 firm | 2 | patterns 0–2, 3, 4, 5–9, number systems 0 and 1 |
| (c) Catima colours / links | 8 + 12 | 9 | signed ARGB ↔ #rrggbb (doc value −9977996 ↔ #67bf74), doc example link in fragment AND legacy query form, 3 hosts, look-alike host, `& = + %` and newline through the double encoding, emoji, barcodeid ≠ cardid, balance "12.50" stays a string, ms timestamps; generated links parsed by the ORACLE |
| (c) Catima import | 12 (7 / 4 / 1) | 8 | A4 hand-written v2 export (20 cards, all 16 Catima types, MAXICODE/RSS_14/RSS_EXPANDED → none + "Catima type: X", empty type → none, negative colours, empty colour, ms expiry/validfrom, SECONDS lastused, multi-line + quoted notes, 12 scripts, 4 groups + links, front/back/icon/orphan images); A13 fixture **12 imported / 2 skipped / 1 duplicate**; the same against a wallet with one duplicate; "keep both"; pre-2.0 bare CSV with a missing/unknown column; BOM + CRLF; zip without `catima.csv`; zip4j AES zip (method 99) refused; "Food"/"food" one category; 2,100 cards; same number different format kept |
| (c) Catima export | 2 firm | 2 | ENGINE writer → ORACLE reader: version line `2`, every Catima-known field, groups/links, numeric image ids `card_<n>_front.png` (D29), lastused ÷ 1000 |
| (d) LC1 share payload | 17 parse + 8 make | 15 | full/minimal/escaped/Unicode payloads; wrong prefix/case, broken JSON, non-object, missing/81-char/non-string name, unknown format, bad colour, trailing garbage; generator: ≤ 1,200 bytes incl. `LC1:`, note cut with "…" as a prefix of the original, never inside a surrogate pair (emoji), multi-byte notes, `truncated` reported, no cut when it fits |
| (d) own backup | 9 import + 1 round trip + 4 tamper | 10 | hand-written backup (SQL column names, see A9) with images; six CHECK-rule row skips; refusals: no backup.json, broken JSON, version 2, not a zip, a Catima zip; duplicate vs wallet; engine round trip of every field incl. tile/chain/use_count/sort; tampered engine backups |
| (d) generic CSV | 9 (6 / 2 / 1) | 5 | `,` `;` tab, BOM, CRLF, header aliases (store/cardid/type/barcodetype), Catima names and aliases (EAN13, Code 128, QR, UPC-E), unknown/empty format → suggestFormats first match, empty name / no number skipped, RFC 4180 quoting, reordered + unknown columns, duplicates |
| (b) render set | 320 values × 6 variants | 54 | Code 128 32 (1 and 80 chars, all-digit C, odd digit runs, every subset switch, all punctuation, caret text), EAN-13 25 (every check digit ×2, every first digit), EAN-8 20 (+ twins), UPC-A 22, UPC-E 24 (both number systems × every expansion pattern), ITF 22 (4–24 digits, ITF-14 with right and WRONG GS1 check), Codabar 26 (all 16 start/stop pairs, all specials, body 2, no letters), Code 39 22 / Code 93 22 (full-ASCII look-alikes, own-check look-alike), QR 30 / Aztec 25 / PDF417 25 / Data Matrix 25 (1 and 1,000 chars, 1,000 digits, umlauts, kana/kanji, emoji, Arabic, Cyrillic, mojibake look-alike text, caret after non-ASCII, literal `^ECI000026`, an LC1 payload, 2,000-byte QR) |

## 2. How to run (builder, once, after the snapshot commit)

All commands with `python3 -I -B` (isolated, no bytecode written). Paths below are relative to this folder.

**A2 render round trip.** For every entry of `render-cases.json` the engine renders `value` with `format` and
rasterises at module width 2, 3 and 4 px × contrast `full` (#000 on #fff) and `dim` (#333 on #bbb), one PNG each,
named `<id>__m<px>__<full|dim>.png` (e.g. `R-EAN13-003__m3__dim.png`) in a folder OUTSIDE this set. Then:
```
swiftc -O decode.swift -o <scratch>/decode && <scratch>/decode --info      # record OS + Vision revision with the figure
ls <pngdir>/*.png > <scratch>/list.txt && <scratch>/decode @<scratch>/list.txt > <scratch>/decode.jsonl
python3 -I -B score.py render <scratch>/decode.jsonl --json <scratch>/render-score.json
```
Output per format × px × contrast: exact %, missed, **WRONG** (a payload that is not the expected value, any
symbology), absent PNGs; A2 gates at 3 px (1D and QR ≥ 99.5 %, Aztec/PDF417/Data Matrix ≥ 99 %, dim ≥ 97 %); the
"decoded as a different value" count (target 0); a lenient Codabar figure (letters ignored) for information. The
builder's own `npm run blind` may score the same decodes; the figures must agree.

**Everything else.** An adapter (builder-written, committed BEFORE the run) calls the engine for each case in
`cases.json` and writes `answers.json`:
```
{"engine": "<snapshot commit>", "answers": {"<case id>": <answer>, ...}}
python3 -I -B score.py cases <answers.json> --json <scratch>/cases-score.json
```
File paths inside answers are relative to `answers.json`. Answer per `kind` (Card = `{name, number, codeValue
(effective barcode value = code_value or number), format, color, note, balance, currency, validFrom, expiry
(unix ms or null), favourite, archived (bool), lastUsedAt (ms or null), categories [names], hasFront, hasBack, tile,
chainId, useCount, sortIndex}` — give every field the engine has; only expected fields are compared):

| kind | input | answer |
|---|---|---|
| validate | `{format, value}` | `{ok, normalised, reason, suggestedCheck?, leadingZeroSuggestion?, uppercased?}`; `reason` mapped to `charset｜length｜check｜numbersystem｜startstop｜capacity｜empty` |
| suggest | `{value, hint?}` (hint in our format ids) | `{formats: [ids the engine says the value SATISFIES, ranked]}` |
| upce-expand | `{upce}` | `{upca}` |
| color-to-hex / color-to-int | `{argb}` / `{hex}` | `{hex}` / `{int}` |
| catima-share-parse, lc1-parse | `{url}` / `{text}` | `{ok, card}` |
| catima-share-make | `{card}` | `{url}` |
| lc1-make | `{card}` | `{text, truncated}` |
| catima-import, csv-import, backup-import | `{file, existing: [cards already in the wallet], duplicateRule: skip｜keep}` | `{refused, reason?, reasonClass?, imported, skipped, duplicates, cards: [Card], categories: [names]}` |
| catima-export | `{cards}` (photos where hasFront/hasBack; any image bytes) | `{zip}` |
| backup-roundtrip | `{cards}` | `{zip, readBack: <import answer>}` |
| backup-tamper | `{cards, tamper: [ops]}` | import answer after: engine writes a backup of `cards`, applies the ops to that zip (`set-top` key/value on backup.json; `set-card` index/column (SQL column name → the engine's key)/value; `delete-file` path), engine reads it |

Score lines: **core** = verdict and value right (ok + normalised; import counts and every expected card field);
**strict** = core + reason class + suggested check digit / leading-zero suggestion / upper-case note. Reported per kind,
per strength and for the adversarial subset; every failure listed; ambiguous cases printed with the engine's answer.

**A1 cross-check (optional).** `python3 -I -B oracle.py batch < values.jsonl` (`{"format","value"}` per line) prints
this oracle's verdict per line, for the builder's ≥ 5,000-values-per-family comparison.

**Self-test (author, re-runnable).** `python3 -I -B selftest.py --vision <decode bin> <probe bin> --workdir <scratch>`
(`swiftc -O probe.swift -o <scratch>/probe`). Result 2026-10-16: **SELFTEST PASS** — 198 cases, oracle vs
hand-written expectations 188/188 agree, 188/188 mutated answers rejected by the scorer, 1,920 synthetic render
decodes scored exactly and planted wrong/missing decodes caught; own renders: 286 of 320 values self-rendered and all
286 decoded EXACTLY by Vision at 3 px full, 3 px dim and 2 px full (0 wrong); 24/24 conventions below hold. The 34
not self-renderable: 30 non-ASCII Aztec/PDF417 values (CoreImage writes no ECI; their expectation rests on D31 and on
convention C21 proven for Data Matrix) and 4 Data Matrix values > 44 codewords (the probe encoder is single-region).

## 3. Decoder conventions (macOS 27.0.1, `VNDetectBarcodesRequest` revision 4, all 24 symbologies enabled)

Proven on the author's own symbols (`selftest.py --vision`, list `CONVENTIONS`):

| # | Convention | Consequence for `expectDecoded` |
|---|---|---|
| C01 | UPC-A is reported as **EAN13 with a leading 0** | `expectDecoded = "0" + value`, symbology EAN13 |
| C02 | UPC-E is reported as **UPCE, 8 digits, not expanded** | value as is |
| C03/C04 | EAN-8/UPC-E twins: the symbology tells which was drawn | render as `upce` must come back UPCE (informational `exact-other-symbology` otherwise) |
| C05 | ITF (also a valid ITF-14) is reported as **I2of5**, leading zeros kept | value as is; ITF14/I2of5Checksum count as the same family |
| C06 | 2-digit ITF is not read | ITF ≥ 4 (spec) |
| C07 | Codabar **start/stop letters are included** | explicit letters must come back exactly; values without letters carry `expectDecodedPattern ^[A-D]<value>[A-D]$` |
| C08 | Codabar with a 1-character body is not read | D30 confirmed independently |
| C09 | a Code 39 mod-43 check character is NOT stripped (`CODE39W`) | an engine that appends a check reads as a DIFFERENT value |
| C10 | Code 39 full-ASCII pairs (`+A $M %U /A`) come back literally | expectDecoded = literal text |
| C11 | Code 93's two check characters are stripped | value as is (D28: engine must include them) |
| C12 | Code 128 keeps leading/trailing spaces | render values are trimmed canonical values |
| C13/C14 | wrong check digits (EAN-13, UPC-E via expansion) are not read | Vision verifies EAN/UPC checks |
| C15/C16 | QR with UTF-8 bytes and NO ECI decodes correctly, even a lone "é" | QR expectDecoded = value (D31: plain UTF-8) |
| C17/C19/C20 | Aztec, PDF417, Data Matrix with UTF-8 bytes and no ECI decode as **Latin-1 mojibake** (`MÃ¼ller`) | the dangerous class D31 fixes |
| C18 | Aztec with Latin-1 bytes decodes correctly | — |
| C21/C22 | Data Matrix with **ECI 26** + UTF-8 decodes exactly, a caret after non-ASCII stays literal (`ü^065`) | Aztec/PDF417/DM expectDecoded = value |
| C23 | #333 on #bbb at 2 px still reads an EAN-13 | dim proxy is decodable |
| C24 | a MALFORMED Codabar (wrong bar pattern for "9") was reported as a valid **EAN13 5511466239200** | Vision can turn an encoder bug into a different value in another symbology → the scorer counts any non-matching payload as WRONG, whatever its symbology |

Also: `payloadData` is the symbol's raw codeword stream, not the message bytes — never compare it. `payloadStringValue`
is the only compared field. One image may carry several results; a case is exact only if a result matches and none
differs ("mixed" counts as WRONG).

## 4. Ambiguities and the reading chosen (L6: owner/builder may overrule; ambiguous cases are not scored)

- **A1 Size.** The task says 100–200 cases; SPEC A2/§13 says ≥ 300 render values. Both met: 198 cases + 320 render values.
- **A2 Codabar without letters** → the engine chooses the letters; any A–D pair accepted. Explicit letters scored strictly.
- **A3 Codabar half-framed** (`A1234`, `1234B`) → invalid `startstop` (inferred).
- **A4 "≤ 1,000 chars"** counted in code points; the 1,000-boundary is only scored with BMP characters (V-QR-09 unscored).
- **A5 2D capacity.** The char rule does not guarantee encodability. Inferred from §2/§7 (Save only for valid values):
  > 2953 / 1914 / 1108 / 1556 UTF-8 bytes (absolute QR/Aztec/PDF417/DM maxima) → invalid `capacity`; ≤ 1,000 bytes
  (PDF417), 1,500 (Aztec/DM), 2,331 (QR) → must work; the grey zone between is never used.
- **A6 suggestFormats** total order is unspecified → only first entry, membership and the orders §5.1 names. Ranking
  "ean13 with check shown" for 12 digits is unscored (S-15).
- **A7 normalise** = ECMAScript `trim()` (BOM, NBSP, U+3000 are whitespace); spaces INSIDE an EAN (V-EAN13-22) unscored.
- **A8 Upper-casing** for Code 39/93/Codabar = ASCII a–z only; Unicode mappings (ß→SS, ı→I, ﬁ→FI) must be rejected (inferred).
- **A9 Backup JSON keys.** "cards: […all columns…]" read as SQL column names (`code_value`, `balance_currency`, 0/1
  flags); `exportedAt` written as unix ms. Hand-written backup fixtures depend on this (marked inferred); the
  round-trip and tamper cases do not.
- **A10 Catima balance "0"** = no balance: `""` or `"0"` both accepted.
- **A11 Unknown Catima type note**: only "contains original note" and "contains `Catima type: X`" are scored.
- **A12 Empty `headercolor`**: the engine's default colour is not scored.
- **A13 Groups "Food"/"food"** merge into the first spelling (D26, inferred).
- **A14 Duplicates**: same number AND format; the FIRST occurrence in a file is kept; duplicates against the wallet
  count too (inferred); backups only check against the wallet.
- **A15 LC1**: `LC1:` is case-sensitive; the 1,200-byte budget includes the prefix; the cut keeps code points whole;
  the answer must report `truncated`. Unknown extra keys and invalid numbers for the format are unscored.
- **A16** LC1 with a 2,000-byte code value (LC1-M08), Catima values our validator rejects (CAT-12), a backup colour in
  upper case (BAK-09), a header-less CSV (CSV-09): unscored, printed.
- **A17 UPC-E** 6/7-digit input is invalid (`length`): §5.1 says 8 digits and nothing is padded silently.
- **A18 ITF** has no check digit and no maximum in §5.1 → a 14-digit value with a wrong GS1 check and 20 digits are valid.
- **A19 Scanner hint** uses our format ids; mapping expo-camera names (`itf14`, `upc_a`) is the adapter's job.
- **A20 Reason vocabulary**: the adapter maps engine reasons to the 7 classes above; only the strict figure depends on it.
- **A21 Catima export images**: checked only for cards given photos; numeric ids required (D29).

## 5. Provenance of reused files

A first author started this folder and was cut off. Kept after review: `decode.swift` (checked line by line; added
`--info` and a payloadData note), `probe.swift` (unchanged), `refrender.py` (tables re-checked against the standards;
**one bug found by the self-test and fixed: Codabar "9" was 1010000, correct 1001000** — Vision then read every
Codabar with a 9 as nothing, and one as EAN-13, see C24). `oracle.py` was rewritten; its GS1 check, UPC-E expansion
and Java URL-encoding functions were kept after hand verification. `__pycache__/` holds that author's stale bytecode;
it is not part of the set, not hashed, and left in place (no-deletion rule).

## 6. SHA-256 of every other file (`shasum -a 256`, run in this folder)

```
a3e0b8c198e634a186a5fea93dbf0c77cd33031d86eba15d03ce2ee1d21bce4a  build_set.py
130dfabeb90ef7197d853dd0eb047ade6d826235d539125ce260e804c46e9700  cases.json
c1f09872de0ac641d56d9fb4fd8846f7581d8060057d5949f94dc3b9781aa11c  decode.swift
dab05764964aacc953a7a29586b4c4a58c03c21c42362820bbf6e8a8ec21b572  dmprobe.py
73eeab973b896b0af775a20f95f8db5375af666bf553bc8f7cfb74012730c93e  fixtures/backup/backup-bad-json.zip
c70f0dfd55148ba6c73ff89eb8ca5d4b8d78f3421adb59bea75d82ab9af2f8b5  fixtures/backup/backup-no-json.zip
9f7dbb66b35195ba755fb96c49737d33b1d550ba81741ad7d7f7344cad7ca9de  fixtures/backup/backup-not-a-zip.zip
c8e5e6048b06716535fad54dfa9c2e90ae9526a3065b112a0cda6c3d127202dc  fixtures/backup/backup-skip.zip
ce8d2a8535ebc524892f8eecc0c8427792377f7f6778ba172e82d01ebbb2f7b7  fixtures/backup/backup-upper-colour.zip
baecd64da9d77f5453bc0196d1e556f1bf9aa9d6b374f7070105c8b9b5ed9dbd  fixtures/backup/backup-valid.zip
96e7fd5034f5fcfb141fd186b82f056f707470f74db01a3cc88129e4e5b89ad4  fixtures/backup/backup-version2.zip
e812989a32e477af87d5fe79d183eac51f878f183cc722a02c083834f02d4ae4  fixtures/catima/catima-encrypted.zip
6d53734cceee47da58db2f7c294209287f23fdb43072bee7251b461093d2d7dc  fixtures/catima/catima-no-csv.zip
81e9f1cd9f9295c47ee48dc8340ef63054e49d109c4e71701376c0afe6304873  fixtures/catima/catima-v1.csv
7a9364e3f3c5b1c36ba3e4eff041810a76d79110cac01f76ea1a9e61f9203254  fixtures/catima/catima-v2-2100.zip
5de649a9c5b1c63f53618a1459ad942dfc0c2da4d3c245e8a0614ed94762e756  fixtures/catima/catima-v2-a13.zip
52e2150e7bec11659b1d95bae6aa638d976eecc00ae4f60085b192aac37f9d08  fixtures/catima/catima-v2-bom-crlf.csv
ec1f49e1494815cf21137052b033649afcd9e8a966f1b8efaf9ca502c3c2c8c1  fixtures/catima/catima-v2-full.zip
4a25c26fbb373c64d03169fcc1d69111d04befb67b99f6d49c7011ae0e47ab5d  fixtures/catima/catima-v2-group-case.zip
3f1ded6dc0c0ccae7129ca0fea48e1bc4e67cd39ba1f7a80574d12aa249adc49  fixtures/catima/catima-v2-invalid-values.zip
e5859c18922f649ee3847c01a94b754d836e2da515c1da0a751df4bb4aafacea  fixtures/catima/catima-v2-same-number.zip
41018082c97af659b74891a2928a763098ae5b341074117d4afe49ec2968f22f  fixtures/csv/generic-comma.csv
3cb79245331b95ce5b606cc22256892d3fbb355d1fe7d2942c78f59ca4ea2a68  fixtures/csv/generic-duplicates.csv
17fb111c97b13168c4191a522e9f64b82c6de93777fbd7d7a2c2b742855a42ba  fixtures/csv/generic-no-header.csv
88fb008f2c88ba765cbaace1f784a41275cca1abc8eaf621d09b3442bb907748  fixtures/csv/generic-quoted.csv
d91cdda16bc41804f1f2450c56bae7ea6ba76f65aee723ca4b12cbf4c7c35928  fixtures/csv/generic-reordered.csv
f568a86bb8daf6765acd326e97028ac6c38ce929127193339453d8191a2a755c  fixtures/csv/generic-semicolon.csv
a1178f25a174510eb1526d0a89f8f9627b186630c5c7f980c0dcccb50e433e43  fixtures/csv/generic-skips.csv
78471d07baea4c57928380a89e668b4f4158450269b39d8abafa3880e783ae11  fixtures/csv/generic-tab-bom-crlf.csv
08f4456818515d18c36a70a166efa6929670102f52d260028933b3f5542139e4  fixtures/csv/generic-unknown-format.csv
a1de09f351297aeaa0a0a8fe8774e8954f417ed2ddf5700fc8c0e70e6d472709  fixtures/images/tiny.jpg
cda3141aff245431de79221a2a6148fd65474ef3334ea51841aae2e89798bd04  oracle.py
4624ac6466b95c9d9212e6119eebf7756e71d1dddab3ccf6239b08b11eb2b3c8  probe.swift
238716dfdabb69844597871cd2d9578df49e7c7f9e92afba79e026aae868e179  refrender.py
c13b619dffe9a20aa36b3b907ec80fbf69a3edde4987f321bc758a2f571109e8  render-cases.json
c235c1d873a5a5b450acbfa4c9f3b7aa98cf8322901bc28f7b36cc55740014a0  score.py
5d031db17307ba89379277c62ec9fca336112b1cb75e699afea38235a491c128  selftest.py
```
