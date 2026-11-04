#!/usr/bin/env bash
# Build, install and launch the app on the default simulator/emulator.
# Usage: scripts/native.sh <ios|android> [development|preview|production]
#   development: Debug build that loads JavaScript from Metro (start it with `npm run dev`).
#   preview/production: Release build with JavaScript embedded; runs without Metro.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: native.sh <ios|android> [development|preview|production]}
variant=${2:-development}
export APP_VARIANT=$variant

# ios/ and android/ are generated from app.config.ts (never edit them by hand).
# Regenerate when the variant, app config or native dependencies change.
# No --clean by default: it deletes ios/ and android/, which only the owner may decide. Opt in with PREBUILD_FLAGS=--clean.
# ONE automatic exception (D10): the folder was generated for ANOTHER variant (first word of the marker). Then
# scripts/prebuild-flags.js answers --clean for THIS platform only and says why on stderr: --no-clean would keep the other
# variant's URL scheme, App Group, widget bundle id and Debug/Release pods, i.e. a wrong release build (mood-journal D71).
# Opt out with PREBUILD_KEEP_ON_VARIANT_SWITCH=1. PREBUILD_FLAGS, when set, is used verbatim.
marker="$platform/.generated-for"
stamp="$variant $(cat app.config.ts package-lock.json plugins/*.js | shasum | cut -c1-12)"
if [[ ! -f $marker || "$(cat "$marker")" != "$stamp" ]]; then
  flags=$(node scripts/prebuild-flags.js "$platform" "$variant")
  if [[ $flags =~ (^|[[:space:]])--clean($|[[:space:]]) ]]; then
    # --clean also asks "Continue with uncommitted changes?" on a dirty tree. ios/ and android/ are git-ignored, so that
    # guard protects nothing here and would stall an unattended build (a "no" would leave the old folder with a new stamp).
    export EXPO_NO_GIT_STATUS=1
  fi
  # shellcheck disable=SC2086 # flags are intentionally word-split
  npx expo prebuild $flags --platform "$platform"
  echo "$stamp" >"$marker"
fi
unset SDKROOT # env.sh sets it for prebuild/pod install only; xcodebuild must pick its own iOS SDK

# Dev builds load JavaScript from Metro on THIS app's port (METRO_PORT, env.sh; D11). `--port` bakes it into the build
# (iOS: RCT_METRO_PORT for xcodebuild, only without --no-bundler; Android: -PreactNativeDevServerPort) and expo attaches to
# the Metro already running from this folder. Without one it would start Metro in the foreground and block an unattended
# build, so require `npm run dev` first. Release variants embed the bundle (--no-bundler).
if [[ $variant == development ]] && ! scripts/metro-running.sh; then
  echo "Metro is not running on port $METRO_PORT. Start it first (in the background): npm run dev" >&2
  exit 1
fi

device=$(scripts/boot.sh "$platform")

if [[ $platform == ios ]]; then
  args=(--device "$device")
  if [[ $variant == development ]]; then args+=(--port "$METRO_PORT"); else args+=(--no-bundler --configuration Release); fi
  mkdir -p artifacts
  set +e
  npx expo run:ios "${args[@]}" 2>&1 | tee artifacts/run-ios.log
  status=${PIPESTATUS[0]}
  set -e
  # Expo's final "focus Simulator window" step needs macOS Automation permission; the app is already launched.
  if [[ $status -ne 0 ]] && grep -q "› Opening on" artifacts/run-ios.log && grep -q "System Events" artifacts/run-ios.log; then
    echo "App installed and opened (ignored Simulator window-focus error)."
    status=0
  fi
  [[ $status -eq 0 ]] || exit "$status"
else
  # expo resolves --device by AVD NAME (a serial gives "Could not find device with name"); ANDROID_SERIAL from
  # env.sh still pins adb/Gradle to our emulator, so a plugged-in phone never gets an install.
  args=(--device "$ANDROID_AVD")
  if [[ $variant == development ]]; then args+=(--port "$METRO_PORT"); else args+=(--no-bundler --variant release); fi
  npx expo run:android "${args[@]}"
fi

# Dev builds: open the dev client on THIS app's Metro URL once more, explicitly. `launchMode: most-recent` (app.config.ts)
# then reopens that URL on every later launch, including Maestro's (sibling apps' pattern: card-scanner, loyalty-cards).
if [[ $variant == development ]]; then
  scheme=$(npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)')
  url="$scheme://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO_PORT"
  if [[ $platform == ios ]]; then
    xcrun simctl openurl "$device" "$url" >/dev/null 2>&1 || true
  else
    adb -s "$device" shell am start -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1 || true
  fi
fi
