# Render development set (NOT evidence)

The builder's own values (SPEC §13): ≥ 10 per format incl. minimum/maximum lengths and odd charsets. `npm run referee`
renders them, rasterises at 2/3/4 px per module in two contrasts (black/white, #333 on #bbb) with
`referee/swift/rasterize.swift` and decodes with macOS Vision (`referee/swift/decode.swift`). Tuning only — the evidence
figures come from the blind sets written by separate agents (`blind-1/`, `blind-2/`).

Entry: `{ "format": <id>, "value": <string>, "expectDecoded"?: <string>, "note"?: <string> }`. Without `expectDecoded`
the documented normalisation applies (`test/render-set.ts`): UPC-A compares as EAN-13 with a leading 0, Codabar
without start/stop letters, ITF-14 = ITF.
