// D10: what the variant plugins write. Runs the plugins' own mods on a small manifest / plist / fake Xcode project, so a
// refactor that lets another variant's scheme, App Group or bundle id through, fails
// `npm run verify`. Pattern from mood-journal plugins/release-plugins.test.js.
const withVariantManifest = require('./with-variant-manifest');
const { moveBundleId } = require('./with-variant-manifest');

// Fresh object per test: expo's withMod attaches `mods` to the config object in place.
const BASE = () => ({ name: 'Starter Preview', slug: 'mobile-starter' });
// Ids and schemes come from app.config.ts (ID_PREFIX / APP_ID), so the test survives new-app.sh's id rewrite.
const configText = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.config.ts'), 'utf8');
const ID_PREFIX = /const ID_PREFIX = '([^']+)'/.exec(configText)[1];
const APP_ID = /const APP_ID = '([^']+)'/.exec(configText)[1];
const IDS = { dev: `${ID_PREFIX}.${APP_ID}.dev`, preview: `${ID_PREFIX}.${APP_ID}.preview`, prod: `${ID_PREFIX}.${APP_ID}` };
const SCHEMES = { dev: `${APP_ID}-dev`, preview: `${APP_ID}-preview`, prod: APP_ID };
// What app.config.ts derives for the preview variant.
const PREVIEW_OPTIONS = {
  ownId: IDS.preview,
  otherIds: [IDS.dev, IDS.prod],
  otherSchemes: [SCHEMES.dev, IDS.dev, SCHEMES.prod, IDS.prod],
  otherGroups: [`group.${IDS.dev}`, `group.${IDS.prod}`],
  optionalFeatures: ['android.hardware.camera'],
};

async function runMod(config, platform, name, modResults) {
  const mod = config.mods[platform][name];
  const out = await mod({ ...config, modResults, modRequest: { platform, modName: name, projectRoot: '/tmp', platformProjectRoot: '/tmp', introspect: true } });
  return out.modResults;
}

const manifest = (perms, extra = {}, top = {}) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': perms.map((p) => ({ $: { 'android:name': p } })),
    application: [{ $: { 'android:name': '.MainApplication' }, ...extra }],
    ...top,
  },
});
const schemesOf = (m) => m.manifest.application[0].activity[0]['intent-filter'][0].data.map((d) => d.$['android:scheme']);

test('Info.plist keeps only this variant\'s URL schemes (own scheme, own bundle id, dev-client exp+ scheme)', async () => {
  const plist = await runMod(withVariantManifest(BASE(), PREVIEW_OPTIONS), 'ios', 'infoPlist', {
    CFBundleURLTypes: [
      { CFBundleURLSchemes: [SCHEMES.preview, IDS.preview] },
      { CFBundleURLSchemes: [SCHEMES.dev, IDS.dev] },
      { CFBundleURLSchemes: ['exp+mobile-starter'] },
      { CFBundleURLSchemes: [SCHEMES.prod, IDS.prod] },
    ],
    CFBundleDisplayName: 'Starter Preview',
  });
  expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: [SCHEMES.preview, IDS.preview] }, { CFBundleURLSchemes: ['exp+mobile-starter'] }]);
  expect(plist.CFBundleDisplayName).toBe('Starter Preview');
});

test('Android main activity answers only this variant\'s schemes; the camera feature is optional (no duplicate)', async () => {
  const out = await runMod(
    withVariantManifest(BASE(), PREVIEW_OPTIONS),
    'android',
    'manifest',
    manifest(
      ['android.permission.CAMERA'],
      {
        activity: [
          {
            $: { 'android:name': '.MainActivity' },
            'intent-filter': [
              { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] },
              { data: [{ $: { 'android:scheme': SCHEMES.dev } }, { $: { 'android:scheme': IDS.dev } }, { $: { 'android:scheme': SCHEMES.preview } }, { $: { 'android:scheme': IDS.preview } }, { $: { 'android:scheme': 'exp+mobile-starter' } }] },
            ],
          },
        ],
      },
      { 'uses-feature': [{ $: { 'android:name': 'android.hardware.camera', 'android:required': 'true' } }, { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } }] }
    )
  );
  const activity = out.manifest.application[0].activity[0];
  expect(activity['intent-filter'][0].action).toHaveLength(1); // filters without data are untouched
  expect(activity['intent-filter'][1].data.map((d) => d.$['android:scheme'])).toEqual([SCHEMES.preview, IDS.preview, 'exp+mobile-starter']);
  expect(out.manifest['uses-feature']).toEqual([
    { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } },
    { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
  ]);
  expect(out.manifest['uses-permission'].map((p) => p.$['android:name'])).toEqual(['android.permission.CAMERA']); // permissions are not this plugin's job
});

test('without optionalFeatures no uses-feature is added', async () => {
  const out = await runMod(withVariantManifest(BASE(), { otherSchemes: [SCHEMES.dev] }), 'android', 'manifest', manifest([], { activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ data: [{ $: { 'android:scheme': SCHEMES.dev } }, { $: { 'android:scheme': SCHEMES.preview } }] }] }] }));
  expect(schemesOf(out)).toEqual([SCHEMES.preview]);
  expect(out.manifest['uses-feature']).toBeUndefined();
});

test('entitlements keep only this variant\'s App Group; other entitlements stay', async () => {
  const ent = await runMod(withVariantManifest(BASE(), PREVIEW_OPTIONS), 'ios', 'entitlements', {
    'aps-environment': 'development',
    'com.apple.security.application-groups': [`group.${IDS.preview}`, `group.${IDS.dev}`, `group.${IDS.prod}`],
  });
  expect(ent['com.apple.security.application-groups']).toEqual([`group.${IDS.preview}`]);
  expect(ent['aps-environment']).toBe('development');
  // no App Groups at all (the template today): untouched
  const none = await runMod(withVariantManifest(BASE(), PREVIEW_OPTIONS), 'ios', 'entitlements', { 'aps-environment': 'development' });
  expect(none).toEqual({ 'aps-environment': 'development' });
});

test('Xcode build settings: bundle ids left from another variant move to this variant (widget extension target)', async () => {
  const section = {
    A1: { isa: 'XCBuildConfiguration', buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: `"${IDS.dev}.ExpoWidgetsTarget"` } },
    A1_comment: 'Debug',
    B1: { isa: 'XCBuildConfiguration', buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: IDS.preview } },
    C1: { isa: 'XCBuildConfiguration', buildSettings: { SWIFT_VERSION: '5.0' } },
  };
  await runMod(withVariantManifest(BASE(), PREVIEW_OPTIONS), 'ios', 'xcodeproj', { pbxXCBuildConfigurationSection: () => section });
  expect(section.A1.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).toBe(`"${IDS.preview}.ExpoWidgetsTarget"`);
  expect(section.B1.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).toBe(IDS.preview);
  expect(section.C1.buildSettings).toEqual({ SWIFT_VERSION: '5.0' });
});

test('without ownId the Xcode project is not touched', () => {
  const config = withVariantManifest(BASE(), { otherSchemes: ['x'] });
  expect(config.mods.ios.xcodeproj).toBeUndefined();
});

test('moveBundleId: longest matching id wins; production\'s id is a prefix of the others', () => {
  const others = [IDS.dev, IDS.prod];
  expect(moveBundleId(`"${IDS.dev}.ExpoWidgetsTarget"`, IDS.preview, others)).toBe(`"${IDS.preview}.ExpoWidgetsTarget"`);
  expect(moveBundleId(IDS.dev, IDS.preview, others)).toBe(`"${IDS.preview}"`);
  expect(moveBundleId(`"${IDS.preview}.ExpoWidgetsTarget"`, IDS.preview, others)).toBe(`"${IDS.preview}.ExpoWidgetsTarget"`);
  expect(moveBundleId(`"${IDS.prod}.ExpoWidgetsTarget"`, IDS.dev, [IDS.preview, IDS.prod])).toBe(`"${IDS.dev}.ExpoWidgetsTarget"`);
  expect(moveBundleId('"org.other.app"', IDS.dev, others)).toBe('"org.other.app"');
});

describe('app.config.ts wiring', () => {
  const load = (variant) => {
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
  };
  const pluginOptions = (cfg, file) => cfg.plugins.find((p) => Array.isArray(p) && p[0] === file)?.[1];

  test('preview: release blockedPermissions and the variant plugin gets the other variants\' ids', () => {
    const cfg = load('preview');
    expect(cfg.android.blockedPermissions).toContain('android.permission.POST_NOTIFICATIONS');
    expect(cfg.android.blockedPermissions).not.toContain('android.permission.INTERNET');
    expect(cfg.android.blockedPermissions).not.toContain('android.permission.CAMERA');
    expect(cfg.plugins).not.toContain('expo-notifications');
    expect(pluginOptions(cfg, './plugins/with-variant-manifest.js')).toEqual(PREVIEW_OPTIONS);
  });

  test('development: only WRITE_SETTINGS and RECORD_AUDIO blocked (D40), same plugins with the dev ids', () => {
    const cfg = load('development');
    expect(cfg.android.blockedPermissions).toEqual(['android.permission.WRITE_SETTINGS', 'android.permission.RECORD_AUDIO']);
    const o = pluginOptions(cfg, './plugins/with-variant-manifest.js');
    expect(o.ownId).toBe(IDS.dev);
    expect(o.otherIds).toEqual([IDS.preview, IDS.prod]);
    expect(o.otherSchemes).toEqual([SCHEMES.preview, IDS.preview, SCHEMES.prod, IDS.prod]);
  });

  test('production: blockedPermissions and only the production ids kept', () => {
    const cfg = load('production');
    expect(cfg.android.blockedPermissions).toBeDefined();
    expect(pluginOptions(cfg, './plugins/with-variant-manifest.js').otherGroups).toEqual([`group.${IDS.dev}`, `group.${IDS.preview}`]);
  });
});
