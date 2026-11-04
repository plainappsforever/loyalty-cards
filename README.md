# Tillcard

All your loyalty cards in one offline wallet. No account, no ads, no tracking.

Tillcard keeps your loyalty, membership, library and customer cards in one wallet on your phone. Open it, tap a card, and the code is on the screen. No account, no ads, no analytics, no network code: your cards stay on the phone.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/loyalty-cards/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/loyalty-cards/) · [GitHub Releases](https://github.com/plainappsforever/loyalty-cards/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/loyalty-cards)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Tillcard is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

ADD A CARD
• Scan the barcode with the camera, type the number, or read it from a photo or screenshot of the card. Screenshots help when you move your cards over from another app.
• A number read from a photo is shown next to the card to compare before you save, because a reader can mistake a small or damaged code.
• The number is checked against the barcode type (for example the check digit of an EAN-13). Tillcard tells you what does not fit and never changes a number silently.
• 13 barcode types: Code 128, EAN-13, EAN-8, UPC-A, UPC-E, ITF, Codabar, Code 39, Code 93, QR, Aztec, PDF417 and Data Matrix. Or keep a card as a number only.
• Pick a well-known shop name for a colour and the usual barcode type, or type your own. No logos.

AT THE TILL
• The card screen shows the code, the number in large type with a Copy button, and the barcode type.
• The screen is brightened while a card is open and set back when you leave, and it stays on. Both can be switched off in Settings.
• Tap the code for full screen. A wide code turns sideways to get bigger.
• Some scanners, mostly older laser ones, cannot read a phone screen. Tillcard cannot change that, which is why the number is always shown: a cashier can type it.

ORGANISE
• Categories, favourites, search, and sort by name, most used or recent. Archive a card instead of deleting it; a deleted card can be brought back for a few seconds.
• Photos of the front and back, a note, a balance you keep yourself (points or money), valid-from and expiry dates.

TAKE YOUR CARDS WITH YOU
• Import Catima files (zip or CSV), Tillcard backups, or any spreadsheet with name and number columns. A summary says how many cards were added, skipped or already there.
• Export a Catima file, a backup with photos, or a CSV, and use them whenever you like. Not affiliated with Catima.
• Share a card with family: a QR code the other phone scans, a file, or a Catima link.

WIDGETS AND SHORTCUTS
• Home-screen widgets for your favourite cards, and a long press on the app icon for the ones you use most.

PRIVATE
There is no account and no server. Cards, photos and notes stay on this phone unless you export or share them. No ads, no analytics, no tracking. The camera is used only when you scan a card; nothing is recorded or sent. The app has no internet permission. Open source under GPL-3.0.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/loyalty-cards/privacy

## Build from source

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/loyalty-cards.git
cd loyalty-cards
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Tillcard was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
