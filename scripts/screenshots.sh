#!/usr/bin/env bash
# App Store screenshots (RELEASE_KIT 3f): cards list, card with its code, add card, share QR, settings - in English, then
# in German - captured by Maestro (.maestro/screenshots/*.yaml) on a Release build installed on a 6.9-inch simulator,
# with a clean status bar (9:41, full battery and signal). Ported from interval-timer/scripts/screenshots.sh (iOS only here).
# Usage: scripts/screenshots.sh [preview|production]
#   The App Store's 6.9-inch size (1320 x 2868) needs an iPhone 17 Pro Max. The script uses the simulator
#   SCREENSHOT_IOS_SIM (default "Tillcard iPhone Pro Max", created on IOS_RUNTIME by boot.sh if missing) and installs the
#   variant's newest simulator Release .app from DerivedData there (build it first: scripts/native.sh ios <variant>).
#   Preview is the default: it has the seed route (typed WIPE, D54); a production build has no seed route.
# Output: artifacts/screenshots/ios/{en,de}/0N-<name>.png (overwritten on the next run; Maestro's own run folder stays).
# Nothing leaves the Mac. The status-bar override is removed again at the end; the app language is set back to the phone's.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

variant=${1:-preview}
[[ $variant == preview ]] || { echo "Screenshots need the preview build (seed route); production has none." >&2; exit 1; }

config=$(APP_VARIANT=$variant npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)' <<<"$config")
scheme=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")
dest="artifacts/screenshots/ios"
run="artifacts/maestro/ios-$variant-screenshots-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest/en" "$dest/de" "$run"

export IOS_SIMULATOR="${SCREENSHOT_IOS_SIM:-Tillcard iPhone Pro Max}"
[[ $IOS_SIMULATOR == "Loyalty iPhone" ]] || export IOS_DEVICE_TYPE="iPhone 17 Pro Max"
device=$(scripts/boot.sh ios)
# Always install the newest Release build, so a stale copy from an earlier run is never photographed.
product=$(node -e 'const c=JSON.parse(process.argv[1]); console.log(c.name.replace(/[^A-Za-z0-9]/g, ""))' "$config")
app=$(ls -dt "$HOME/Library/Developer/Xcode/DerivedData/$product"-*/Build/Products/Release-iphonesimulator/"$product".app 2>/dev/null | head -1 || true)
[[ -n $app ]] || { echo "No $product.app Release build found. Run: scripts/native.sh ios $variant" >&2; exit 1; }
echo "Installing $app on $IOS_SIMULATOR"
xcrun simctl install "$device" "$app"
xcrun simctl status_bar "$device" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100
cleanup() { xcrun simctl status_bar "$device" clear >/dev/null 2>&1 || true; }
trap cleanup EXIT

status=0
mt() { maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" --test-output-dir "$run" "$@" || status=$?; }
mt -e SHOTS=en .maestro/screenshots/listing.yaml
mt -e LANG_ID=de .maestro/screenshots/language.yaml
mt -e SHOTS=de .maestro/screenshots/listing.yaml
mt -e LANG_ID=system .maestro/screenshots/language.yaml

# Maestro 2.x files each takeScreenshot under <output>/<run>/<flow>/takeScreenshot/.
count=0
for lang in en de; do
  for name in 01-cards 02-card 03-add 04-share 05-settings; do
    shot=$(find "$run" -name "$lang-$name.png" | head -1)
    if [[ -z $shot ]]; then
      echo "MISSING: $lang-$name" >&2
      status=1
      continue
    fi
    cp "$shot" "$dest/$lang/$name.png"
    count=$((count + 1))
  done
done
echo "Screenshots: $count of 10 in $dest (Maestro run: $run)"
for f in "$dest"/en/0*.png "$dest"/de/0*.png; do [[ -f $f ]] && sips -g pixelWidth -g pixelHeight "$f" | awk -v f="$f" '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {print "  " f ": " w " x " h}'; done
exit "$status"
