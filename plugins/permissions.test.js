// P8a (D51; pattern: interval-timer F4; SPEC §6.1/§10, A15): the release Android permission list is EXACTLY
// CAMERA (the barcode scan, asked at the first Scan) (+ AndroidX's own signature permission
// `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which only this app can hold). No INTERNET, no
// notifications, no storage, no microphone, no VIBRATE until the scan haptic (SPEC §7.3) is built.
// Built from what the build really merges, never from a hard-coded list of the result:
//  1. the prebuild template's AndroidManifest.xml (node_modules/expo/template.tgz), with app.config's android.permissions
//     applied the way Expo's prebuild does;
//  2. every autolinked native module's own src/main/AndroidManifest.xml (`expo-modules-autolinking resolve` and
//     `react-native-config` for Android: a NEW library that asks for a permission fails this test);
//  3. permissions that Gradle dependencies (AARs, invisible here) merged into earlier preview APKs, read with aapt
//     (V1_LOG P8 build 1 and the fix round's APK) - KNOWN_AAR below;
// then the release variants' own mods (blockedPermissions -> tools:node="remove", plugins/with-no-internet.js) run on
// that manifest and the survivors are compared. Bundle ids come from app.config.ts. Binary check: `aapt dump
// permissions` of the preview APK (V1_LOG "Fix round after review 2026-10-26").
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AndroidConfig, XML } = require('expo/config-plugins');

const withNoInternet = require('./with-no-internet');

const ROOT = path.join(__dirname, '..');
const EXPECTED = ['android.permission.CAMERA'];
// Merged from AARs (aapt of the preview APK, V1_LOG P8a): androidx.core declares and uses the app-private receiver
// permission. ACCESS_NETWORK_STATE (Glide via expo-image) is listed because the manifest merge brings it in; it is blocked.
const KNOWN_AAR = (pkg) => ['android.permission.ACCESS_NETWORK_STATE', `${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];

function loadConfig(variant) {
  let cfg;
  jest.isolateModules(() => {
    const before = process.env.APP_VARIANT;
    process.env.APP_VARIANT = variant;
    try {
      cfg = require('../app.config.ts').default({ config: {} });
    } finally {
      if (before === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = before;
    }
  });
  return cfg;
}

const permissionsIn = (xml) => [...xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);

function autolinking(command) {
  const bin = require.resolve('expo-modules-autolinking/bin/expo-modules-autolinking.js', { paths: [path.dirname(require.resolve('expo/package.json'))] });
  return JSON.parse(execFileSync(process.execPath, [bin, command, '-p', 'android', '-j'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

/** Android source folders of every module the build links (Expo modules + React Native libraries). */
function linkedAndroidDirs() {
  const expo = autolinking('resolve').modules.flatMap((m) => m.projects.map((p) => ({ name: m.packageName, dir: p.sourceDir })));
  const rn = Object.entries(autolinking('react-native-config').dependencies ?? {})
    .map(([name, d]) => ({ name, dir: d.platforms?.android?.sourceDir }))
    .filter((d) => d.dir);
  return [...expo, ...rn];
}

/** Permission -> who declares it, for every linked module's main manifest. */
function libraryPermissions() {
  const by = new Map();
  for (const { name, dir } of linkedAndroidDirs()) {
    const file = path.join(dir, 'src/main/AndroidManifest.xml');
    if (!fs.existsSync(file)) continue;
    for (const p of permissionsIn(fs.readFileSync(file, 'utf8'))) by.set(p, [...(by.get(p) ?? []), name]);
  }
  return by;
}

async function templateManifest() {
  const tgz = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
  const xml = execFileSync('tar', ['-xOzf', tgz, 'package/android/app/src/main/AndroidManifest.xml'], { encoding: 'utf8' });
  return XML.parseXMLAsync(xml);
}

/** The permissions left after the variant's manifest mods and the Gradle manifest merge. */
async function mergedPermissions(variant) {
  const cfg = loadConfig(variant);
  const manifest = AndroidConfig.Permissions.setAndroidPermissions(cfg, await templateManifest());
  const noInternet = cfg.plugins.find((p) => Array.isArray(p) && p[0] === './plugins/with-no-internet.js')[1];
  let mods = AndroidConfig.Permissions.withBlockedPermissions({ name: 'x', slug: 'x' }, cfg.android.blockedPermissions ?? []);
  mods = withNoInternet(mods, noInternet);
  const out = await mods.mods.android.manifest({ ...mods, modResults: manifest, modRequest: { platform: 'android', modName: 'manifest', projectRoot: ROOT, platformProjectRoot: '/tmp', introspect: true }, modRawConfig: {} });
  const entries = (out.modResults.manifest['uses-permission'] ?? []).map((p) => p.$);
  const removed = new Set(entries.filter((p) => p['tools:node'] === 'remove').map((p) => p['android:name']));
  const app = entries.filter((p) => p['tools:node'] !== 'remove').map((p) => p['android:name']);
  const all = new Set([...app, ...libraryPermissions().keys(), ...KNOWN_AAR(cfg.android.package)]);
  return { kept: [...all].filter((p) => !removed.has(p)).sort(), removed, cfg };
}

jest.setTimeout(30_000);

test.each(['preview', 'production'])('%s: the merged permission list is exactly CAMERA (+ the app-private AndroidX permission)', async (variant) => {
  const { kept, cfg } = await mergedPermissions(variant);
  expect(kept).toEqual([...EXPECTED, `${cfg.android.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`].sort());
});

test('development keeps INTERNET (Metro) and nothing the app needs is ever blocked', async () => {
  const { kept, removed } = await mergedPermissions('development');
  expect(kept).toContain('android.permission.INTERNET');
  for (const p of EXPECTED) expect(removed.has(p)).toBe(false);
});

test('CAMERA is really declared by expo-camera (the "exactly" above is not vacuous) and no library asks for Google, push or network permissions', () => {
  const libs = libraryPermissions();
  expect(libs.get('android.permission.CAMERA')).toContain('expo-camera');
  const names = [...libs.keys()];
  expect(names.filter((p) => /c2dm|finsky|gms|firebase|badge|BADGE|RECEIVE_BOOT_COMPLETED|LOCATION/.test(p))).toEqual([]);
  // P8a: neither expo-notifications nor expo-application (install referrer) is linked
  expect(linkedAndroidDirs().map((d) => d.name)).not.toContain('expo-notifications');
  expect(linkedAndroidDirs().map((d) => d.name)).not.toContain('expo-application');
});

test('every release-blocked permission is one the app does not need (nothing in EXPECTED is blocked)', () => {
  for (const variant of ['preview', 'production']) {
    const blocked = loadConfig(variant).android.blockedPermissions;
    for (const p of EXPECTED) expect(blocked).not.toContain(p);
    expect(blocked).not.toContain('android.permission.INTERNET'); // removed by with-no-internet, not by blockedPermissions
  }
});
