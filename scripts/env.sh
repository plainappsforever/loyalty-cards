# Shared toolchain paths and defaults for project scripts. Source this file; don't run it.
export LANG="${LANG:-en_US.UTF-8}" # CocoaPods requires UTF-8
# Dev builds reach Metro via localhost (Android uses adb reverse); LAN IPs get blocked by firewalls.
export REACT_NATIVE_PACKAGER_HOSTNAME=localhost
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$HOME/.maestro/bin:/opt/homebrew/bin:$PATH"

# Default targets. Override per command, e.g. IOS_SIMULATOR="iPhone 17" npm run ios
export IOS_SIMULATOR="${IOS_SIMULATOR:-Loyalty iPhone}"   # this app's own simulator (D22); boot.sh creates it
# iOS runtime of that simulator. Empty = newest installed (27.0 with Xcode 27). Older one: IOS_RUNTIME=26.5 npm run ios
# boot.sh (scripts/ios-simulator.js) creates IOS_SIMULATOR on the chosen runtime if it does not exist there yet.
export IOS_RUNTIME="${IOS_RUNTIME:-26.5}"   # dev clients do not start on the 27.0 runtime on this Mac (print-cost D97, Offscan P6)
export IOS_DEVICE_TYPE="${IOS_DEVICE_TYPE:-iPhone 17 Pro}"   # device type used once when ios-simulator.js creates IOS_SIMULATOR (P5)
export ANDROID_AVD="${ANDROID_AVD:-Loyalty_API_36}"   # this app's own AVD (D22); P5 creates it once (same image/device as Pixel_9_API_36)
# Each new app picks its own emulator port (5554, 5556, ... even numbers) so apps can run emulators in parallel.
export ANDROID_EMULATOR_PORT="${ANDROID_EMULATOR_PORT:-5750}"   # loyalty-cards (spec session 2026-10-16; 5730 was the highest in use)
# Pin every adb / Gradle (installDebug, expo run:android) / Maestro call to THIS app's emulator, so a plugged-in
# physical phone (or another app's emulator) is never touched.
export ANDROID_SERIAL="emulator-${ANDROID_EMULATOR_PORT}"

# macOS 27 + Xcode 26: CocoaPods (pod install in `expo prebuild`) picks the Command Line Tools macOS SDK 27,
# whose libSystem.B.tbd fails with "malformed file". Pin the Xcode-shipped SDK. native.sh unsets it after prebuild
# because it must not leak into xcodebuild (it would override the iOS SDK).
if [[ -z "${SDKROOT:-}" ]] && _sdk=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null) && [[ -n $_sdk ]]; then
  export SDKROOT="$_sdk"
fi
unset _sdk

# Variant switch (D10): native.sh would run `expo prebuild --clean` (deletes and re-creates the generated ios/ or
# android/ folder) when the last prebuild was for another variant. Deletions are the owner's decision (CLAUDE.md), so
# this stays OFF until the owner confirms the rule; the variant plugins (plugins/with-variant-manifest.js) remain the
# safety net. Owner's yes = delete this line (or set it to 0).
export PREBUILD_KEEP_ON_VARIANT_SWITCH="${PREBUILD_KEEP_ON_VARIANT_SWITCH:-1}"
# Metro port, unique per app (spec session 2026-10-16; card-scanner uses 8230). P1 wires it into boot.sh (adb reverse),
# e2e.sh (status check) and the package.json "dev" script exactly as card-scanner/print-cost did.
export METRO_PORT="${METRO_PORT:-8250}"
