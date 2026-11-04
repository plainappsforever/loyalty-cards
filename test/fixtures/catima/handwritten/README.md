# Hand-written Catima export (P4c, review S11)

`catima.csv` was typed by hand from Catima's documented format (`docs/EXPORT_FORMAT.md`, `docs/CARD_FIELDS.md`) and the
conventions of `CatimaExporter` (version line `2`, CRLF, RFC 4180 quoting, `expiry`/`validfrom` in ms, `lastused` in
seconds, signed ARGB `headercolor`, `barcodeencoding` ISO-8859-1 as Catima's default). It was NOT produced by our writer —
unlike `../dev/sample-v2.zip` — so it tests the reader against the format, not against itself. `expected.json` is
hand-written too. Cases: valid EAN-13/UPC-A/Code 128 (separate barcode value)/QR/Aztec (Latin-1 marked), a 12-digit
EAN-13 (→ number only with the reason, review M1), MAXICODE (→ number only, type in the note), lower-case Code 39,
a card without a barcode type, a multi-line note with an EMPTY line inside quotes, zero balance (= none), a duplicate,
an archived card, a 53-character group name (cut to 40, S7), links. Test: `src/engine/catima/fixtures.test.ts`.
