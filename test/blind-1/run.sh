#!/bin/bash
# Blind set B1 — the ONE measurement (L27). Run from a checkout of the engine snapshot; committed before it runs.
# Writes the full log to docs/blind-1-first-run.txt and refuses to run when that file exists (a second run is not evidence).
# Work files (PNGs, decode.jsonl, answers.json, exports) go to artifacts/blind-1/ (git-ignored), outside the set.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SET="$ROOT/test/fixtures/render/blind-1"
WORK="$ROOT/artifacts/blind-1"
LOG="$ROOT/docs/blind-1-first-run.txt"
README_SHA=2a5836b8786bbb5932ce5b72fdb3cb48206da332ed5a65e49931dbc1ef933d71
if [ -e "$LOG" ]; then echo "$LOG exists: B1 was measured already; a re-run is not evidence (L27)"; exit 2; fi
mkdir -p "$WORK/png"
cd "$ROOT" || exit 2
run() { echo; echo "\$ $*"; "$@"; echo "[exit $?]"; }
{
  echo "Blind set B1 — FIRST RUN (evidence, L27) — loyalty-cards"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion)), $(uname -m)"
  echo "engine snapshot: $(git rev-parse HEAD)  ($(git log -1 --format=%s bcc75af 2>/dev/null))"
  echo "measured tree: $(git rev-parse --short HEAD) = snapshot + this set + test/blind-1/ (adapter); src/ diff vs bcc75af:"
  git diff --stat bcc75af HEAD -- src | tail -1; echo "(empty line above = src/ untouched)"
  echo "node $(node --version), swiftc: $(swiftc --version 2>&1 | head -1)"
  echo
  echo "== 1. Hash check (README §6 list + README itself)"
  echo "README.md expected $README_SHA"
  echo "README.md actual   $(shasum -a 256 "$SET/README.md" | cut -d' ' -f1)"
  sed -n '/^## 6/,$p' "$SET/README.md" | grep -E '^[0-9a-f]{64}  ' > "$WORK/hashes.txt"
  (cd "$SET" && shasum -a 256 -c "$WORK/hashes.txt" | sed 's/^/  /'; echo "  shasum exit ${PIPESTATUS[0]}")
  echo "  files in set copy: $(cd "$SET" && find . -type f | wc -l | tr -d ' ') (= $(wc -l < "$WORK/hashes.txt" | tr -d ' ') listed + README)"
  echo
  echo "== 2. A2 render round trip"
  run swiftc -O "$SET/decode.swift" -o "$WORK/decode"
  run "$WORK/decode" --info
  run node --import ./scripts/node/ts-hooks.mjs test/blind-1/render-driver.ts "$SET/render-cases.json" "$WORK/png"
  ls "$WORK"/png/*.png > "$WORK/list.txt"
  echo "PNGs: $(wc -l < "$WORK/list.txt" | tr -d ' ')"
  echo "\$ $WORK/decode @$WORK/list.txt > $WORK/decode.jsonl"
  "$WORK/decode" "@$WORK/list.txt" > "$WORK/decode.jsonl"; echo "[exit $?] $(wc -l < "$WORK/decode.jsonl" | tr -d ' ') lines"
  run python3 -I -B "$SET/score.py" render "$WORK/decode.jsonl" --json "$WORK/render-score.json"
  echo
  echo "== 3. Cases (adapter → answers.json → score.py cases)"
  run node --import ./scripts/node/ts-hooks.mjs test/blind-1/answers-adapter.ts "$SET" "$WORK/answers.json" "$(git rev-parse HEAD) (engine = bcc75af)"
  run python3 -I -B "$SET/score.py" cases "$WORK/answers.json" --json "$WORK/cases-score.json"
  echo
  echo "== end. Work files: $WORK (decode.jsonl, render-score.json, answers.json, cases-score.json, out/)"
} 2>&1 | tee "$LOG"
