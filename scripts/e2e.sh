#!/usr/bin/env bash
# Run Maestro flows against the build already installed on the simulator/emulator.
# Usage: scripts/e2e.sh <ios|android> [development|preview|production] [flow.yaml ...]
# With no flows, runs every top-level flow in .maestro/.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: e2e.sh <ios|android> [variant] [flows...]}
variant=${2:-development}
shift $(($# >= 2 ? 2 : 1))
flows=("$@")
[[ ${#flows[@]} -gt 0 ]] || flows=(.maestro)

app_id=$(APP_VARIANT=$variant npx expo config --json --type public | node -e \
  'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)')

# The variant's URL scheme: Maestro links use ${SCHEME}://… (P8a: the test routes also exist in preview, never production).
scheme=$(APP_VARIANT=$variant npx expo config --json --type public | node -e \
  'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)')
label=$(APP_VARIANT=$variant npx expo config --json --type public | node -e \
  'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).name)')

if [[ $variant == development ]] && ! scripts/metro-running.sh; then
  echo "Metro is not running on port $METRO_PORT. Start it with: npm run dev" >&2
  exit 1
fi

device=$(scripts/boot.sh "$platform")
out="artifacts/maestro/$platform-$variant-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "Maestro: $app_id on $platform ($device) -> $out"
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" -e APP_LABEL="$label" --test-output-dir "$out" "${flows[@]}"
