// loyalty-cards P8: copied from pregnancy-tracker P6 (vitals-log / mood-journal / print-cost pattern; SPEC §3/§10, A18, D20): release variants (preview,
// production) ship WITHOUT android.permission.INTERNET — the app has no network code; links open in the browser, which
// is another app with its own permission. Development builds need INTERNET to reach Metro.
// Two parts for a release prebuild: drop the permission Expo's template declares in the app manifest, and add a
// tools:node="remove" marker so a library manifest cannot bring it back during the merge. `expo prebuild --no-clean`
// keeps a manifest an earlier release prebuild wrote, so a development prebuild takes the remove markers (INTERNET and
// the release-only `blockedPermissions` passed in as `alsoUnblock`) out again and puts INTERNET back: without that the
// dev client crashed at start in mood ("NsdService: … no INTERNET").
// Never touches VIBRATE (expo-haptics, D20). No exact-alarm permission at all (D14).
const { withAndroidManifest } = require('expo/config-plugins');

const INTERNET = 'android.permission.INTERNET';

module.exports = function withNoInternet(config, { release = true, alsoUnblock = [] } = {}) {
  const devUnblock = [INTERNET, ...alsoUnblock];
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const perms = manifest['uses-permission'] ?? [];
    if (release) {
      const others = perms.filter((p) => p.$['android:name'] !== INTERNET);
      others.push({ $: { 'android:name': INTERNET, 'tools:node': 'remove' } });
      manifest['uses-permission'] = others;
    } else {
      const kept = perms.filter((p) => !(p.$['tools:node'] === 'remove' && devUnblock.includes(p.$['android:name'])));
      if (!kept.some((p) => p.$['android:name'] === INTERNET)) kept.push({ $: { 'android:name': INTERNET } });
      manifest['uses-permission'] = kept;
    }
    return mod;
  });
};
