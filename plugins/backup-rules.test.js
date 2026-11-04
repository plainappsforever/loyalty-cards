// D12: the app's SQLite database never leaves the phone through an OS backup (step-counter D57, cycle-tracker review M4,
// vitals-log D60; plugin pattern from photo-vault plugins/with-vault-backup-rules.js). Runs the plugin's own mods, the
// way variant-plugins.test.js does, and parses the generated XML, so a refactor that drops a section, the device-transfer
// exclusion or the API 24–30 file fails `npm run verify`.
const { XML, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withBackupRules = require('./with-backup-rules');
const { fullBackupContent, dataExtractionRules, setBackupAttributes, SQLITE_DIR, FULL_BACKUP_XML, EXTRACTION_XML } = withBackupRules;

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

const manifest = (appAttrs = {}) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'true', ...appAttrs } }],
  },
});

async function runManifestMod(config, modResults) {
  const out = await config.mods.android.manifest({
    ...config,
    modResults,
    modRequest: { platform: 'android', modName: 'manifest', projectRoot: '/tmp', platformProjectRoot: '/tmp', introspect: true },
  });
  return out.modResults.manifest.application[0].$;
}

// expo-secure-store 57's own manifest step (node_modules/expo-secure-store/plugin/build/withSecureStore.js, read from
// pregnancy-tracker on 2026-10-26): it applies ITS rule files only when no other rules are set, otherwise it warns and
// leaves the manifest alone. The template does not depend on expo-secure-store; this copy proves the two merge in either
// plugin order.
const SECURE_BACKUP = '@xml/secure_store_backup_rules';
const SECURE_EXTRACTION = '@xml/secure_store_data_extraction_rules';
function withFakeSecureStore(config) {
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    const backup = app.$['android:fullBackupContent'];
    const extraction = app.$['android:dataExtractionRules'];
    if ((!backup || backup === SECURE_BACKUP) && (!extraction || extraction === SECURE_EXTRACTION)) {
      app.$['android:fullBackupContent'] = SECURE_BACKUP;
      app.$['android:dataExtractionRules'] = SECURE_EXTRACTION;
    }
    return cfg;
  });
}

const OURS = { 'android:fullBackupContent': `@xml/${FULL_BACKUP_XML}`, 'android:dataExtractionRules': `@xml/${EXTRACTION_XML}` };

describe('app.config.ts', () => {
  test.each(['development', 'preview', 'production'])('%s: allowBackup false and the backup-rules plugin registered', (variant) => {
    const cfg = loadConfig(variant);
    expect(cfg.android.allowBackup).toBe(false);
    expect(cfg.plugins).toContain('./plugins/with-backup-rules.js');
  });

  test("Expo's own allowBackup step writes android:allowBackup=\"false\" from the config", () => {
    const m = manifest();
    AndroidConfig.AllowBackup.setAllowBackup(loadConfig('production'), m);
    expect(m.manifest.application[0].$['android:allowBackup']).toBe('false');
  });
});

describe('manifest', () => {
  test('both rule files are referenced (API 24–30 and API 31+); allowBackup is left to app.config.ts', async () => {
    const attrs = await runManifestMod(withBackupRules({ name: 'x', slug: 'x' }), manifest());
    expect(attrs).toEqual({ 'android:name': '.MainApplication', 'android:allowBackup': 'true', ...OURS });
    expect(() => setBackupAttributes({ $: {} })).toThrow('no <application>');
  });

  test.each([
    ['secure-store first', (c) => withBackupRules(withFakeSecureStore(c))],
    ['secure-store last', (c) => withFakeSecureStore(withBackupRules(c))],
  ])('merges with expo-secure-store (%s): our files win and they carry its exclusion', async (_, apply) => {
    const attrs = await runManifestMod(apply({ name: 'x', slug: 'x' }), manifest());
    expect(attrs).toMatchObject(OURS);
    for (const xml of [fullBackupContent(), dataExtractionRules()]) expect(xml).toContain('<exclude domain="sharedpref" path="SecureStore"/>');
  });
});

describe('rule files', () => {
  const excludes = (node) => (node?.exclude ?? []).map((e) => `${e.$.domain}:${e.$.path}`);

  test("expo-sqlite's folder: filesDir/SQLite on Android = domain file, path SQLite/", () => {
    // node_modules/expo-sqlite/android/src/main/java/expo/modules/sqlite/SQLiteModule.kt: filesDir + "/SQLite"
    const pkg = path.dirname(require.resolve('expo-sqlite/package.json'));
    const kotlin = fs.readFileSync(path.join(pkg, 'android/src/main/java/expo/modules/sqlite/SQLiteModule.kt'), 'utf8');
    expect(kotlin).toMatch(/context\.filesDir\.canonicalPath \+ File\.separator \+ "SQLite"/);
    expect(SQLITE_DIR).toBe('SQLite/');
  });

  test('API 24–30 (full-backup-content): the database folder, card photos, widget PNGs (D49) and SecureStore are excluded', async () => {
    const xml = await XML.parseXMLAsync(fullBackupContent());
    expect(excludes(xml['full-backup-content'])).toEqual(['file:SQLite/', 'file:cards/', 'file:widgets/', 'sharedpref:SecureStore']);
  });

  test('API 31+ (data-extraction-rules): excluded from cloud backup AND device-to-device transfer', async () => {
    const xml = await XML.parseXMLAsync(dataExtractionRules());
    const rules = xml['data-extraction-rules'];
    expect(rules['cloud-backup']).toHaveLength(1);
    expect(rules['device-transfer']).toHaveLength(1);
    expect(excludes(rules['cloud-backup'][0])).toEqual(['file:SQLite/', 'file:cards/', 'file:widgets/', 'sharedpref:SecureStore']);
    expect(excludes(rules['device-transfer'][0])).toEqual(['file:SQLite/', 'file:cards/', 'file:widgets/', 'sharedpref:SecureStore']);
  });

  test('the dangerous mod writes both files into res/xml', async () => {
    const mkdir = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    try {
      const config = withBackupRules({ name: 'x', slug: 'x' });
      await config.mods.android.dangerous({
        ...config,
        modResults: {},
        modRequest: { platform: 'android', modName: 'dangerous', projectRoot: '/p', platformProjectRoot: '/p/android', introspect: false },
      });
      expect(mkdir).toHaveBeenCalledWith('/p/android/app/src/main/res/xml', { recursive: true });
      expect(write).toHaveBeenCalledWith(`/p/android/app/src/main/res/xml/${FULL_BACKUP_XML}.xml`, fullBackupContent());
      expect(write).toHaveBeenCalledWith(`/p/android/app/src/main/res/xml/${EXTRACTION_XML}.xml`, dataExtractionRules());
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
    }
  });
});
