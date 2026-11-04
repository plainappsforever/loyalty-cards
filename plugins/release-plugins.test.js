// P8a (SPEC §10, A15; pattern: interval-timer plugins/release-plugins.test.js): the release-hygiene plugins on small
// inputs, and which variant gets what. Ids and schemes are read from app.config.ts, never written here.
const withNoInternet = require('./with-no-internet');
const withDevClientLinking = require('./with-dev-client-linking');
const withoutDevClientResidue = require('./without-dev-client-residue');
const withoutPushEntitlement = require('./without-push-entitlement');

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
const options = (cfg, file) => cfg.plugins.find((p) => Array.isArray(p) && p[0] === file)?.[1];

function runManifestMod(plugin, opts, manifest) {
  const cfg = plugin({ name: 'x', slug: 'x' }, opts);
  return cfg.mods.android.manifest({ modResults: manifest, modRequest: { platform: 'android' }, modRawConfig: {} });
}

test('no-INTERNET: release variants remove INTERNET with a merge marker; development puts it back', async () => {
  const release = options(loadConfig('preview'), './plugins/with-no-internet.js');
  const production = options(loadConfig('production'), './plugins/with-no-internet.js');
  const dev = options(loadConfig('development'), './plugins/with-no-internet.js');
  expect(release.release).toBe(true);
  expect(production.release).toBe(true);
  expect(dev.release).toBe(false);
  const manifest = () => ({
    manifest: {
      $: {},
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }, { $: { 'android:name': 'android.permission.CAMERA' } }],
      application: [{ $: {} }],
    },
  });
  const r = await runManifestMod(withNoInternet, release, manifest());
  const perms = r.modResults.manifest['uses-permission'].map((p) => p.$);
  expect(perms).toContainEqual({ 'android:name': 'android.permission.INTERNET', 'tools:node': 'remove' });
  expect(perms.filter((p) => p['android:name'] === 'android.permission.INTERNET')).toHaveLength(1);
  expect(perms).toContainEqual({ 'android:name': 'android.permission.CAMERA' });
  const d = await runManifestMod(withNoInternet, dev, manifest());
  expect(d.modResults.manifest['uses-permission'].map((p) => p.$)).toContainEqual({ 'android:name': 'android.permission.INTERNET' });
});

test('a development prebuild after a release one takes the release remove markers out again (--no-clean keeps them)', async () => {
  const dev = options(loadConfig('development'), './plugins/with-no-internet.js');
  const stale = {
    manifest: {
      $: {},
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET', 'tools:node': 'remove' } },
        { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW', 'tools:node': 'remove' } },
      ],
      application: [{ $: {} }],
    },
  };
  const r = await runManifestMod(withNoInternet, dev, stale);
  expect(r.modResults.manifest['uses-permission'].map((p) => p.$)).toEqual([{ 'android:name': 'android.permission.INTERNET' }]);
  expect(dev.alsoUnblock).toContain('android.permission.SYSTEM_ALERT_WINDOW'); // development unblocks the release list
});

test('release blockedPermissions never include what the app needs; development blocks only the two of D40', () => {
  const blocked = loadConfig('production').android.blockedPermissions;
  for (const p of ['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'SYSTEM_ALERT_WINDOW', 'ACCESS_NETWORK_STATE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'WRITE_SETTINGS', 'RECORD_AUDIO']) {
    expect(blocked).toContain(`android.permission.${p}`);
  }
  expect(blocked).not.toContain('android.permission.CAMERA');
  expect(loadConfig('development').android.blockedPermissions).toEqual(['android.permission.WRITE_SETTINGS', 'android.permission.RECORD_AUDIO']);
});

test('the development client is configured for development only and unlinked from release Podfiles', () => {
  const dev = loadConfig('development');
  const preview = loadConfig('preview');
  expect(dev.plugins).toContainEqual(['expo-dev-client', { launchMode: 'most-recent' }]);
  expect(preview.plugins).not.toContainEqual(['expo-dev-client', { launchMode: 'most-recent' }]);
  expect(preview.plugins).not.toContain('./plugins/with-dev-menu-defaults.js');
  expect(options(preview, './plugins/with-dev-client-linking.js')).toEqual({ release: true });
  expect(options(dev, './plugins/with-dev-client-linking.js')).toEqual({ release: false });
  const podfile = "target 'App' do\n  use_expo_modules!\nend\n";
  const out = withDevClientLinking.podfile(podfile, true);
  expect(out).toContain("use_expo_modules!(exclude: ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'])");
  expect(withDevClientLinking.podfile(out, false)).toBe(podfile);
});

test('residue plugin: release Android manifest loses EXDevMenu/updates meta-data and foreign or exp+ schemes, keeps its own', async () => {
  const cfgv = loadConfig('preview');
  const keep = options(cfgv, './plugins/without-dev-client-residue.js').keep;
  const base = keep.replace(/-preview$/, '');
  const manifest = {
    manifest: {
      $: {},
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          'meta-data': [
            { $: { 'android:name': 'EXDevMenuShowsAtLaunch', 'android:value': 'false' } },
            { $: { 'android:name': 'expo.modules.updates.ENABLED', 'android:value': 'false' } },
            { $: { 'android:name': 'keep.me', 'android:value': '1' } },
          ],
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': [
                { data: [{ $: { 'android:scheme': keep } }, { $: { 'android:scheme': `${base}-dev` } }, { $: { 'android:scheme': `exp+${base}` } }] },
                { data: [{ $: { 'android:scheme': `${base}-dev` } }] },
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] },
              ],
            },
          ],
        },
      ],
    },
  };
  const r = await runManifestMod(withoutDevClientResidue, { keep, release: true }, manifest);
  const app = r.modResults.manifest.application[0];
  expect(app['meta-data'].map((m) => m.$['android:name'])).toEqual(['keep.me']);
  const filters = app.activity[0]['intent-filter'];
  expect(filters).toHaveLength(2); // the filter whose only scheme was foreign is gone
  expect(filters[0].data.map((d) => d.$['android:scheme'])).toEqual([keep]);
  expect(filters[1].action).toBeDefined();
});

test('residue plugin: release Info.plist loses the dev-client keys and foreign schemes, keeps its own', async () => {
  const keep = options(loadConfig('preview'), './plugins/without-dev-client-residue.js').keep;
  const base = keep.replace(/-preview$/, '');
  const cfg = withoutDevClientResidue({ name: 'x', slug: 'x' }, { keep, release: true });
  const plist = {
    EXDevMenuShowsAtLaunch: false,
    NSLocalNetworkUsageDescription: 'Expo Dev Launcher uses the local network',
    NSBonjourServices: ['_expo._tcp'],
    CFBundleURLTypes: [{ CFBundleURLSchemes: [keep, `${base}-dev`] }, { CFBundleURLSchemes: [`exp+${base}`] }],
  };
  const r = await cfg.mods.ios.infoPlist({ modResults: plist, modRequest: { platform: 'ios' }, modRawConfig: {} });
  expect(r.modResults).toEqual({ CFBundleURLTypes: [{ CFBundleURLSchemes: [keep] }] });
});

test('the residue plugin comes first and the signing plugin is registered for every variant; no expo-notifications anywhere', () => {
  for (const variant of ['development', 'preview', 'production']) {
    const cfg = loadConfig(variant);
    expect(Array.isArray(cfg.plugins[0]) && cfg.plugins[0][0]).toBe('./plugins/without-dev-client-residue.js');
    expect(cfg.plugins).toContain('./plugins/with-release-signing.js');
    expect(cfg.plugins.flat()).not.toContain('expo-notifications');
  }
  const pkg = require('../package.json');
  for (const dep of ['expo-notifications', 'expo-application', '@react-native-firebase/app', '@react-native-firebase/messaging']) {
    expect(pkg.dependencies).not.toHaveProperty([dep]);
  }
  const lock = require('../package-lock.json');
  expect(Object.keys(lock.packages).filter((k) => /node_modules\/(expo-notifications|expo-application|badgin)$/.test(k))).toEqual([]);
});

test('widget extension (P8b): Release gets -O, no debug dylib, iPhone only; Debug untouched; registered before expo-widgets', () => {
  const { applyReleaseSettings } = require('./with-widget-release-settings');
  const debug = { name: 'Debug', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"', TARGETED_DEVICE_FAMILY: '"1,2"' } };
  const release = { name: 'Release', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"', TARGETED_DEVICE_FAMILY: '"1,2"' } };
  const appRelease = { name: 'Release', buildSettings: { PRODUCT_NAME: 'App' } };
  const project = {
    pbxTargetByName: (n) => (n === 'ExpoWidgetsTarget' ? { buildConfigurationList: 'L1' } : null),
    pbxXCConfigurationList: () => ({ L1: { buildConfigurations: [{ value: 'D' }, { value: 'R' }] } }),
    pbxXCBuildConfigurationSection: () => ({ D: debug, R: release, A: appRelease }),
  };
  expect(applyReleaseSettings(project, 'ExpoWidgetsTarget')).toBe(1);
  expect(release.buildSettings).toEqual({ SWIFT_OPTIMIZATION_LEVEL: '"-O"', ENABLE_DEBUG_DYLIB: 'NO', TARGETED_DEVICE_FAMILY: '1' });
  expect(debug.buildSettings.SWIFT_OPTIMIZATION_LEVEL).toBe('"-Onone"');
  expect(appRelease.buildSettings).toEqual({ PRODUCT_NAME: 'App' });
  expect(applyReleaseSettings(project, 'Missing')).toBe(0);
  const plugins = loadConfig('preview').plugins;
  const mine = plugins.indexOf('./plugins/with-widget-release-settings.js');
  const widgets = plugins.findIndex((p) => Array.isArray(p) && p[0] === 'expo-widgets');
  expect(mine).toBeGreaterThan(-1);
  expect(mine).toBeLessThan(widgets);
});

test('push entitlement (P8b): aps-environment is removed, the App Group stays; the plugin is registered for every variant', async () => {
  const cfg = withoutPushEntitlement({ name: 'x', slug: 'x' });
  const r = await cfg.mods.ios.entitlements({
    modResults: { 'aps-environment': 'development', 'com.apple.security.application-groups': ['group.x'] },
    modRequest: { platform: 'ios' },
    modRawConfig: {},
  });
  expect(r.modResults).toEqual({ 'com.apple.security.application-groups': ['group.x'] });
  for (const variant of ['development', 'preview', 'production']) {
    expect(loadConfig(variant).plugins).toContain('./plugins/without-push-entitlement.js');
  }
});
