import type { ConfigContext, ExpoConfig } from 'expo/config';

import brand from './src/constants/brand.json';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
// Identifiers: com.plainapps.<app> (owner decision 2026-10-15 for the portfolio; card-scanner D10 pattern). The product
// name is PROVISIONAL until the owner picks one of the three store-name options in the spec report (DECISIONS D10);
// change APP_NAME / APP_ID here and in src/constants/app.ts (P1 creates it) — nothing else refers to the name.
const ID_PREFIX = 'com.plainapps';
const APP_NAME = 'Tillcard'; // D11 default (store: "Tillcard: Loyalty Card Wallet"), applied in P5 (D40)
const APP_ID = 'loyaltycards';
const VARIANTS = {
  development: { name: `${APP_NAME} Dev`, id: `${ID_PREFIX}.${APP_ID}.dev`, scheme: `${APP_ID}-dev` },
  preview: { name: `${APP_NAME} Preview`, id: `${ID_PREFIX}.${APP_ID}.preview`, scheme: `${APP_ID}-preview` },
  production: { name: APP_NAME, id: `${ID_PREFIX}.${APP_ID}`, scheme: APP_ID },
} as const;

type Variant = keyof typeof VARIANTS;

// F1 / D54: a Release build of Xcode (expo-constants' "Generate app.config" phase runs this file with CONFIGURATION=Release)
// without APP_VARIANT would embed the DEVELOPMENT config in an App Store binary (scheme loyaltycards-dev, test routes open).
// Refuse instead of defaulting. Gradle sets no such marker: scripts/check-variant.sh reads the config back out of the built
// .apk/.aab/.app/.xcarchive, and src/lib/variant.ts keeps the test routes closed unless the variant is preview/development.
if (process.env.APP_VARIANT === undefined && /^release/i.test(process.env.CONFIGURATION ?? '')) {
  throw new Error('APP_VARIANT is not set in a Release build. Prefix the command with APP_VARIANT=production (or preview), see docs/RELEASE_KIT.md.');
}
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

// D24: splash and Android icon background come from the app's identity file (src/constants/brand.json), never a literal
// here; src/constants/brand.test.ts fails a preview/production config that still carries the template placeholder.
const IDENTITY = {
  splash: { light: brand.light.background, dark: brand.dark.background },
  iconBackground: brand.light.accent,
};
const others = Object.values(VARIANTS).filter((v) => v.id !== id);
const release = variant !== 'development';
const IOS_LOCALIZATIONS = ['en', 'de', 'es', 'pt-BR', 'fr', 'it', 'tr', 'ru', 'id', 'hi', 'ja', 'zh-Hans', 'ko', 'vi'];

// P7 (SPEC §6.4, D48): iOS widget "Tillcard" via expo-widgets (adds the ExpoWidgetsTarget extension and the App Group
// group.<bundle id>; simulator builds sign it ad hoc, a device build needs a team id). WIDGETS=0 builds without it.
// Android has its own RemoteViews widgets in modules/cards-widget (expo-widgets is excluded from Android autolinking in
// package.json, mood-journal D68).
const widgetsEnabled = process.env.WIDGETS !== '0';
// APPLE_TEAM_ID (optional, not a secret) becomes ios.appleTeamId (DEVELOPMENT_TEAM in the generated project) for archives; interval-timer pattern.
const appleTeamId = process.env.APPLE_TEAM_ID || undefined;

// Release variants block Android permissions that library manifests merge in and nothing in the app uses
// (mood-journal D70, `aapt dump permissions` of its first preview APK; template D10). Each line says who adds the
// permission and why it is not needed.
// Blocked in EVERY variant (P5, D40): expo-brightness's plugin adds WRITE_SETTINGS (system brightness; we only set the
// window brightness, D14) and expo-camera adds RECORD_AUDIO (video recording; we only scan barcodes).
const ALWAYS_BLOCKED = ['android.permission.WRITE_SETTINGS', 'android.permission.RECORD_AUDIO'];
// P8a (D51): expo-notifications is gone, and with it Firebase push (c2dm) and ShortcutBadger's launcher-badge permissions;
// their lines went with it. The two below were expo-notifications' own; kept as a belt (blocking an unrequested permission
// costs nothing): SPEC §10 has no notifications and nothing starts at boot.
const RELEASE_BLOCKED = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // Expo's prebuild template declares SYSTEM_ALERT_WINDOW (dev overlays); the development client's manifest adds
  // CHANGE_WIFI_MULTICAST_STATE (Bonjour). expo-image (Glide) and others merge ACCESS_NETWORK_STATE. Nothing here draws over
  // other apps, discovers servers or watches the network.
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
  'android.permission.ACCESS_NETWORK_STATE',
  // Added by libraries up to API 32; files come through the system pickers and the share sheet (SPEC §10 "no storage").
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // Expo's prebuild template declares VIBRATE. The scan haptic (SPEC §7.3) is not built yet (expo-haptics not installed,
  // V1_LOG L11); the day it is, remove this line and add VIBRATE to EXPECTED in plugins/permissions.test.js (D51).
  'android.permission.VIBRATE',
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'loyalty-cards',
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    ...(appleTeamId ? { appleTeamId } : {}),
    // F7 (review): explicit, start at 1; raise by one for every upload (App Store build number / Play versionCode, F-Droid reads it).
    buildNumber: '2',
    icon: './assets/expo.icon',
    // P8b (App Store export compliance): the app uses no encryption beyond the system's (ITSAppUsesNonExemptEncryption).
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // P8b (interval-timer F7): the UI languages of src/i18n, so the App Store and the system sheets (share, document
      // picker) know the app speaks them. Arabic is left out on purpose: declaring `ar` mirrors the native navigation bar
      // while the React Native layout stays left-to-right (interval-timer P9). All 13 non-en/de files are MACHINE DRAFTS
      // (D50) with real strings, not placeholders. Pinned by plugins/localizations.test.js.
      CFBundleLocalizations: IOS_LOCALIZATIONS,
    },
  },
  android: {
    package: id,
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: IDENTITY.iconBackground,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // D12 / D49 (SPEC §10): no OS backup of the cards; data moves only through the app's own export files.
    allowBackup: false,
    blockedPermissions: release ? [...ALWAYS_BLOCKED, ...RELEASE_BLOCKED] : [...ALWAYS_BLOCKED],
  },
  plugins: [
    // P8a (pdf-scanner/print-cost/interval-timer pattern): only this variant's URL scheme; release variants also lose the
    // development-client residue (EXDevMenu keys, exp+ scheme). FIRST, so its mods run after the others'.
    ['./plugins/without-dev-client-residue.js', { keep: scheme, release }],
    // P8b: no push entitlement (expo-widgets adds aps-environment although the widgets use no push; read from the preview build).
    './plugins/without-push-entitlement.js',
    'expo-router',
    ['expo-splash-screen', { backgroundColor: IDENTITY.splash.light, dark: { backgroundColor: IDENTITY.splash.dark }, image: './assets/images/splash-icon.png', imageWidth: 96 }],
    'expo-sqlite',
    'expo-localization',
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended. Development only: release
    // variants do not link the development client on iOS (with-dev-client-linking.js, print-cost D83), and a variant switch
    // re-creates the native folder (template D10), so nothing of it is left behind.
    ...(release ? [] : [['expo-dev-client', { launchMode: 'most-recent' }] as [string, object], './plugins/with-dev-menu-defaults.js']),
    ['./plugins/with-dev-client-linking.js', { release }],
    // P8a, A15 / SPEC §10: no INTERNET in preview/production (dev builds need it for Metro); a development prebuild takes the
    // release-only remove markers out again.
    ['./plugins/with-no-internet.js', { release, alsoUnblock: release ? [] : [...RELEASE_BLOCKED] }],
    // P8a: Android release builds use the owner's upload key from a properties file OUTSIDE the repo
    // (~/Developer/.keys/loyalty-cards-release.properties) when it exists; otherwise the debug key with a warning.
    './plugins/with-release-signing.js',
    // D12 / D49: the database, card photos and widget PNGs are excluded from cloud backup AND device transfer (API 31+
    // reads these rules even with allowBackup=false) and from the API 24–30 full backup.
    './plugins/with-backup-rules.js',
    // D10: only THIS variant's URL schemes (Expo also registers the bundle id as a scheme), App Group and bundle-id prefix
    // survive a `prebuild --no-clean` after another variant; camera declared optional for Play. Keep it before any plugin
    // that adds an extension target (expo-widgets).
    [
      './plugins/with-variant-manifest.js',
      {
        ownId: id,
        otherIds: others.map((v) => v.id),
        otherSchemes: others.flatMap((v) => [v.scheme, v.id]),
        otherGroups: others.map((v) => `group.${v.id}`),
        optionalFeatures: ['android.hardware.camera'],
      },
    ],
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md D9.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
    // SPEC §6.1 (Price Book D65 pattern): CameraView scanning with the bundled ML Kit model; camera only, no microphone.
    [
      'expo-camera',
      {
        cameraPermission: `${APP_NAME} uses the camera only to read the barcode of a loyalty card you add. Nothing is recorded or sent.`,
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    // Photos come through the system picker (no library permission, SPEC §6.5); no camera/microphone strings from here.
    ['expo-image-picker', { photosPermission: false, microphonePermission: false }],
    // Google's code scanner (launchScanner, downloaded by Play services on first use) stays out; CameraView's bundled
    // ML Kit scanner and modules/code-kit's ML Kit stay (price-book D65 plugin, D40).
    './plugins/without-google-code-scanner.js',
    // S2: "Open with Tillcard" for .zip and .csv files (iOS document types, Android VIEW intent filter).
    './plugins/with-open-with.js',
    ...(widgetsEnabled
      ? [
          // Before expo-widgets on purpose (its target must exist when this plugin's mod runs; eye-app D88).
          './plugins/with-widget-privacy-manifest.js',
          // P8b (interval-timer P8): expo-widgets builds its extension with -Onone and the SwiftUI preview dylib in Release too.
          // Before expo-widgets so this Xcode mod runs after the one that adds the target.
          './plugins/with-widget-release-settings.js',
          [
            'expo-widgets',
            {
              enableAndroid: false,
              widgets: [
                {
                  name: 'CardsWidget',
                  displayName: APP_NAME,
                  // One string for every language (expo-widgets); says what a tap does (L26).
                  description: 'Your cards one tap from the till. Tap a card to show its code.',
                  supportedFamilies: ['systemSmall', 'systemMedium', 'accessoryCircular', 'accessoryRectangular'],
                  contentMarginsDisabled: false,
                  // iOS 17+: which card (position in the widget list: chosen, favourites, most used). Fixed values: the
                  // list itself lives in the app, so the choice is a position, not a card name (D48).
                  configuration: {
                    title: 'Card',
                    description: 'Which of your widget cards to show',
                    parameters: {
                      card: {
                        title: 'Card',
                        type: 'enum',
                        // values must be Swift identifiers (expo-widgets): card1 … card8
                        default: 'card1',
                        values: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `Card ${n}`, value: `card${n}` })),
                      },
                    },
                  },
                },
              ],
            },
          ] as [string, unknown],
        ]
      : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
    widgetsEnabled,
  },
});
