#!/bin/bash
# Blind set B1 — the cases half, run ONCE after run.sh's cases step crashed before producing any answer: plain Node's
# strip-only TypeScript loader rejects the engine's `constructor(public readonly code …)` parameter properties
# (src/engine/backup/reader.ts, src/engine/catima/reader.ts). No answers.json existed and nothing was scored, so the
# cases were not measured. Only change: Node runs the adapter with --experimental-transform-types (full TS transform);
# adapter and engine unchanged. Appends to docs/blind-1-first-run.txt; refuses when answers.json exists.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SET="$ROOT/test/fixtures/render/blind-1"
WORK="$ROOT/artifacts/blind-1"
LOG="$ROOT/docs/blind-1-first-run.txt"
if [ -e "$WORK/answers.json" ]; then echo "answers.json exists: the cases were measured already (L27)"; exit 2; fi
grep -q "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" "$LOG" || { echo "run.sh's log does not show the loader crash; nothing to complete"; exit 2; }
cd "$ROOT" || exit 2
run() { echo; echo "\$ $*"; "$@"; echo "[exit $?]"; }
{
  echo
  echo "== 3b. Cases, completed (the step above crashed in Node's TS loader before writing any answer; see test/blind-1/run-cases.sh)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)   tree: $(git rev-parse HEAD); src/ diff vs bcc75af:"
  git diff --stat bcc75af HEAD -- src | tail -1; echo "(empty line above = src/ untouched)"
  run node --experimental-transform-types --no-warnings --import ./scripts/node/ts-hooks.mjs test/blind-1/answers-adapter.ts "$SET" "$WORK/answers.json" "$(git rev-parse HEAD) (engine = bcc75af)"
  run python3 -I -B "$SET/score.py" cases "$WORK/answers.json" --json "$WORK/cases-score.json"
  echo
  echo "== end (cases). Work files: $WORK (answers.json, cases-score.json, out/)"
} 2>&1 | tee -a "$LOG"
