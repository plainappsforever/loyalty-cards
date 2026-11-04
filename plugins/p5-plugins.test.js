// P5 plugins (D40): with-open-with (S2) and without-google-code-scanner. Runs each plugin's own mods on a small manifest /
// plist / build.gradle, twice, so prebuild --no-clean (which re-applies to an already patched file) stays idempotent.
const withOpenWith = require('./with-open-with');
const withoutGoogleCodeScanner = require('./without-google-code-scanner');

const BASE = () => ({ name: 'Tillcard Dev', slug: 'loyalty-cards' });

async function runMod(config, platform, name, modResults) {
  const mod = config.mods[platform][name];
  const out = await mod({ ...config, modResults, modRequest: { platform, modName: name, projectRoot: '/tmp', platformProjectRoot: '/tmp', introspect: true } });
  return out.modResults;
}

const manifest = () => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    application: [
      {
        $: { 'android:name': '.MainApplication' },
        activity: [
          {
            $: { 'android:name': '.MainActivity' },
            'intent-filter': [
              { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
              { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'loyaltycards-dev' } }] },
            ],
          },
        ],
      },
    ],
  },
});

test('Android: one VIEW filter for zip/csv on the main activity, other filters kept, idempotent', async () => {
  let m = await runMod(withOpenWith(BASE()), 'android', 'manifest', manifest());
  m = await runMod(withOpenWith(BASE()), 'android', 'manifest', m);
  const filters = m.manifest.application[0].activity[0]['intent-filter'];
  expect(filters).toHaveLength(3);
  const open = filters[2];
  expect(open.action[0].$['android:name']).toBe('android.intent.action.VIEW');
  expect(open.category[0].$['android:name']).toBe('android.intent.category.DEFAULT');
  const mimes = open.data.map((d) => d.$['android:mimeType']).filter(Boolean);
  expect(mimes).toEqual(['application/zip', 'application/x-zip-compressed', 'text/csv', 'text/comma-separated-values']);
  expect(open.data.map((d) => d.$['android:scheme']).filter(Boolean)).toEqual(['content', 'file']);
  expect(filters[1].data[0].$['android:scheme']).toBe('loyaltycards-dev');
});

test('iOS: zip + CSV document types (Alternate, Viewer), copies not in place, idempotent, foreign types kept', async () => {
  const foreign = { CFBundleTypeName: 'Other', LSItemContentTypes: ['public.png'] };
  let p = await runMod(withOpenWith(BASE()), 'ios', 'infoPlist', { CFBundleDocumentTypes: [foreign] });
  p = await runMod(withOpenWith(BASE()), 'ios', 'infoPlist', p);
  expect(p.CFBundleDocumentTypes).toHaveLength(3);
  expect(p.CFBundleDocumentTypes[0]).toEqual(foreign);
  expect(p.CFBundleDocumentTypes.slice(1).map((t) => t.LSItemContentTypes[0])).toEqual(['public.zip-archive', 'public.comma-separated-values-text']);
  expect(p.CFBundleDocumentTypes.slice(1).every((t) => t.LSHandlerRank === 'Alternate' && t.CFBundleTypeRole === 'Viewer')).toBe(true);
  expect(p.LSSupportsOpeningDocumentsInPlace).toBe(false);
});

test('build.gradle: Google code scanner excluded once, nothing else', async () => {
  const gradle = { contents: 'android {\n}\n', language: 'groovy' };
  let g = await runMod(withoutGoogleCodeScanner(BASE()), 'android', 'appBuildGradle', gradle);
  g = await runMod(withoutGoogleCodeScanner(BASE()), 'android', 'appBuildGradle', g);
  expect(g.contents.split(withoutGoogleCodeScanner.MARKER)).toHaveLength(2);
  expect(g.contents).toContain("exclude group: 'com.google.android.gms', module: 'play-services-code-scanner'");
  expect(g.contents).not.toContain('barcode-scanning');
});
