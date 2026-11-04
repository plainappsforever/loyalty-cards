// Spike S2 (SPEC §6.5, A14): "Open with Tillcard" for our backup zip, Catima's zip and CSV exports.
// iOS: CFBundleDocumentTypes for public.zip-archive and public.comma-separated-values-text with LSHandlerRank Alternate
//   (we open them, we do not claim to own them); LSSupportsOpeningDocumentsInPlace = false, so iOS hands the app a COPY
//   (in Documents/Inbox) and the original in Files is never touched.
// Android: a VIEW intent filter on the main activity for application/zip (+ the legacy x-zip-compressed some file managers
//   report), text/csv and text/comma-separated-values, content:// and file:// URIs.
// The app reads the file in the Receive screen (P6 routes the incoming file URL there). Fallback (S2 fails):
// Import → "Choose file" only. Idempotent: prebuild --no-clean keeps what an earlier run wrote.
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const DOCUMENT_TYPES = [
  { CFBundleTypeName: 'Zip archive', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.zip-archive'] },
  { CFBundleTypeName: 'CSV file', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.comma-separated-values-text'] },
];
const MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'text/csv', 'text/comma-separated-values'];

function isOpenWithFilter(f) {
  return (f.action ?? []).some((a) => a.$?.['android:name'] === 'android.intent.action.VIEW') && (f.data ?? []).some((d) => d.$?.['android:mimeType'] === 'application/zip');
}

function openWithFilter() {
  return {
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:scheme': 'content' } }, { $: { 'android:scheme': 'file' } }, ...MIME_TYPES.map((m) => ({ $: { 'android:mimeType': m } }))],
  };
}

module.exports = function withOpenWith(config) {
  config = withInfoPlist(config, (mod) => {
    const own = new Set(DOCUMENT_TYPES.map((t) => t.CFBundleTypeName));
    mod.modResults.CFBundleDocumentTypes = [...(mod.modResults.CFBundleDocumentTypes ?? []).filter((t) => !own.has(t.CFBundleTypeName)), ...DOCUMENT_TYPES];
    mod.modResults.LSSupportsOpeningDocumentsInPlace = false;
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    const main = (app?.activity ?? []).find((a) => a.$?.['android:name'] === '.MainActivity') ?? app?.activity?.[0];
    if (!main) throw new Error('with-open-with: no main activity in AndroidManifest.xml');
    main['intent-filter'] = [...(main['intent-filter'] ?? []).filter((f) => !isOpenWithFilter(f)), openWithFilter()];
    return mod;
  });
};
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
module.exports.MIME_TYPES = MIME_TYPES;
