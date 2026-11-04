#!/usr/bin/env bash
# Open-with end to end (A14, S2): hands the Catima sample zip to the dev build the way the OS does, then checks Receive →
# Add → exact summary → cards, photos and categories (.maestro/open-with/). Metro must run (npm run dev).
#   android [file|content]: the real VIEW intent with `-t application/zip`:
#     file    — the zip copied into the app's own files dir (run-as), data = file:///data/user/0/<pkg>/files/…
#     content — the zip in Downloads, data = its MediaStore content:// URI with a read grant (what file managers send)
#   ios: the zip copied into the app container's Documents/Inbox (where iOS puts an opened file), then the Receive route
#        with that file:// URI — `simctl openurl` on a file URL hangs CoreSimulator (P5, L14), so the route stands in for
#        the system's open-URL hand-off; +native-intent's mapping of file:// → /receive is unit-tested.
# Usage: scripts/e2e-open-with.sh <ios|android> [file|content]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: e2e-open-with.sh <ios|android> [file|content]}
mode=${2:-file}
fixture=test/fixtures/catima/dev/sample-v2.zip
name=catima-sample.zip
app_id=$(npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)')
scripts/metro-running.sh || { echo "Metro is not running on port $METRO_PORT. Start it with: npm run dev" >&2; exit 1; }
device=$(scripts/boot.sh "$platform")
out="artifacts/maestro/$platform-open-with-$mode-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
run() { maestro --device "$device" test -e APP_ID="$app_id" "$@" --test-output-dir "$out"; }

run .maestro/open-with/before.yaml

if [[ $platform == ios ]]; then
  container=$(xcrun simctl get_app_container "$device" "$app_id" data)
  mkdir -p "$container/Documents/Inbox"
  cp "$fixture" "$container/Documents/Inbox/$name"
  uri="file://$container/Documents/Inbox/$name"
  link="loyaltycards-dev://receive?uri=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$uri")"
  echo "iOS: Receive route with $uri"
  run -e LINK="$link" .maestro/open-with/receive.yaml
else
  if [[ $mode == content ]]; then
    adb -s "$device" push "$fixture" "/sdcard/Download/$name" >/dev/null
    adb -s "$device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$name" >/dev/null 2>&1 || true
    sleep 2
    id=$(adb -s "$device" shell content query --uri content://media/external/file --projection _id --where "_display_name=\'$name\'" | tr -d '\r' | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | tail -1)
    [[ -n $id ]] || { echo "MediaStore has no row for $name" >&2; exit 1; }
    uri="content://media/external/file/$id"
    adb -s "$device" shell am start -a android.intent.action.VIEW -t application/zip -d "$uri" --grant-read-uri-permission "$app_id" | tr -d '\r'
  else
    adb -s "$device" push "$fixture" "/data/local/tmp/$name" >/dev/null
    adb -s "$device" shell chmod 644 "/data/local/tmp/$name"
    adb -s "$device" shell run-as "$app_id" cp "/data/local/tmp/$name" "files/$name"
    uri="file:///data/user/0/$app_id/files/$name"
    adb -s "$device" shell am start -a android.intent.action.VIEW -t application/zip -d "$uri" "$app_id" | tr -d '\r'
  fi
  echo "Android: VIEW intent with $uri"
  run -e LINK="" .maestro/open-with/receive.yaml
fi
