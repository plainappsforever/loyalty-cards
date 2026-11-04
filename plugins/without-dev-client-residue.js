// Preview/production builds carry no development-client residue (loyalty-cards P8: copied from pdf-scanner, which ported print-cost's):
// expo-dev-client's plugin and with-dev-menu-defaults write keys for every variant, and `expo prebuild --no-clean` (the
// deletion rule) keeps what an earlier development prebuild wrote — found on the emulator: the Offscan preview APK also
// claimed its dev scheme and `exp+pdf-scanner://`, so Android asked "Open with … Dev / … Preview" for dev links.
// Removes actively: iOS EXDevMenu* keys, NSLocalNetworkUsageDescription, the _expo._tcp Bonjour service,
// NSAllowsLocalNetworking; Android EXDevMenu* / expo.modules.updates.* meta-data; on both, every URL scheme that is a
// dev-client scheme (exp+…) or ANOTHER variant's scheme (`keep` = this variant's own scheme).
// Applied to EVERY variant (listed FIRST in app.config.ts, so its mods run after the others'): other variants' schemes go
// everywhere (a development prebuild after a preview one kept the preview scheme); the dev-client residue goes only when
// `release` is true.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

const VARIANT_SCHEME = /^loyaltycards(-dev|-preview)?$/;

module.exports = function withoutDevClientResidue(config, { keep, release = true } = {}) {
  const foreign = (s) => typeof s === 'string' && ((release && s.startsWith('exp+')) || (VARIANT_SCHEME.test(s) && s !== keep));

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    if (!release) {
      if (Array.isArray(plist.CFBundleURLTypes)) {
        plist.CFBundleURLTypes = plist.CFBundleURLTypes.map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !foreign(s)) })).filter(
          (t) => t.CFBundleURLSchemes.length > 0
        );
      }
      return mod;
    }
    for (const key of Object.keys(plist)) if (key.startsWith('EXDevMenu')) delete plist[key];
    delete plist.NSLocalNetworkUsageDescription;
    const bonjour = (plist.NSBonjourServices ?? []).filter((s) => s !== '_expo._tcp');
    if (bonjour.length > 0) plist.NSBonjourServices = bonjour;
    else delete plist.NSBonjourServices;
    if (plist.NSAppTransportSecurity) {
      delete plist.NSAppTransportSecurity.NSAllowsLocalNetworking;
      if (Object.keys(plist.NSAppTransportSecurity).every((k) => k === 'NSAllowsArbitraryLoads' && plist.NSAppTransportSecurity[k] === false)) {
        delete plist.NSAppTransportSecurity;
      }
    }
    if (Array.isArray(plist.CFBundleURLTypes)) {
      plist.CFBundleURLTypes = plist.CFBundleURLTypes.map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !foreign(s)) })).filter(
        (t) => t.CFBundleURLSchemes.length > 0
      );
    }
    return mod;
  });

  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    if (release) app['meta-data'] = (app['meta-data'] ?? []).filter((m) => {
      const name = m.$?.['android:name'] ?? '';
      return !name.startsWith('EXDevMenu') && !name.startsWith('expo.modules.updates.');
    });
    for (const activity of app.activity ?? []) {
      if (!activity['intent-filter']) continue;
      activity['intent-filter'] = activity['intent-filter'].filter((filter) => {
        if (!filter.data) return true;
        filter.data = filter.data.filter((d) => !foreign(d.$?.['android:scheme']));
        return filter.data.length > 0; // a VIEW filter whose only schemes were foreign goes entirely
      });
    }
    return mod;
  });
};
