// Every build variant answers only to its own identifiers (mood-journal D71, template D10).
// `expo prebuild --no-clean` (the template default; deleting ios/ and android/ is the owner's call) keeps what an earlier
// prebuild of ANOTHER variant wrote, because Expo's scheme and entitlement mods append instead of replacing:
//   - the preview APK still answered `<slug>-dev://` (Android main activity) and the dev scheme stayed in CFBundleURLTypes;
//   - the dev App Group stayed in the preview entitlements (a store build would then need `group.<id>.dev` on its App ID);
//   - expo-widgets reused the widget extension target with the dev bundle id ("Embedded binary's bundle identifier is not
//     prefixed with the parent app's"), so the iOS preview build failed.
// This plugin removes the other variants' URL schemes, App Groups and bundle-id prefixes and leaves everything else alone.
// It is registered for EVERY variant; `scripts/native.sh` additionally re-creates the native folder on a variant switch
// (same decision). Register it BEFORE any plugin that adds an extension target (expo-widgets) so this Xcode mod runs after it.
//
// Also: `optionalFeatures` (template: the camera). A CAMERA permission — added by expo-image-picker/expo-camera the moment
// an app takes photos — makes Play treat `android.hardware.camera` as REQUIRED and hide the app from devices without one.
// Declaring the feature as optional keeps the listing; the app must then cope with a missing camera (the picker does).
const { withAndroidManifest, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

/** `com.x.dev.ExpoWidgetsTarget` → `com.x.preview.ExpoWidgetsTarget` when `com.x.dev` is another variant's id. */
function moveBundleId(value, ownId, otherIds) {
  const raw = String(value).replace(/^"|"$/g, '');
  // The longest matching id decides (production's id is a prefix of the other two).
  const match = [ownId, ...otherIds]
    .filter((o) => raw === o || raw.startsWith(`${o}.`))
    .sort((x, y) => y.length - x.length)[0];
  return match && match !== ownId ? `"${ownId}${raw.slice(match.length)}"` : value;
}

/**
 * @param {object} options
 * @param {string} [options.ownId] this variant's bundle id / package (enables the Xcode bundle-id fix)
 * @param {string[]} [options.otherIds] the other variants' ids
 * @param {string[]} [options.otherSchemes] URL schemes to drop (the other variants' `scheme`s and their ids, which Expo
 *   also registers as schemes)
 * @param {string[]} [options.otherGroups] App Groups to drop (`group.<other id>`)
 * @param {string[]} [options.optionalFeatures] Android `uses-feature` names to declare with required="false"
 */
module.exports = function withVariantManifest(config, { ownId, otherIds = [], otherSchemes = [], otherGroups = [], optionalFeatures = [] } = {}) {
  const foreignScheme = (s) => otherSchemes.includes(s);

  if (ownId) {
    config = withXcodeProject(config, (mod) => {
      const configs = mod.modResults.pbxXCBuildConfigurationSection();
      for (const entry of Object.values(configs)) {
        const settings = entry?.buildSettings;
        if (settings?.PRODUCT_BUNDLE_IDENTIFIER) settings.PRODUCT_BUNDLE_IDENTIFIER = moveBundleId(settings.PRODUCT_BUNDLE_IDENTIFIER, ownId, otherIds);
      }
      return mod;
    });
  }

  config = withEntitlementsPlist(config, (mod) => {
    const key = 'com.apple.security.application-groups';
    if (Array.isArray(mod.modResults[key])) mod.modResults[key] = mod.modResults[key].filter((g) => !otherGroups.includes(g));
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    if (Array.isArray(plist.CFBundleURLTypes)) {
      plist.CFBundleURLTypes = plist.CFBundleURLTypes.map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !foreignScheme(s)) })).filter(
        (t) => t.CFBundleURLSchemes.length > 0
      );
    }
    return mod;
  });

  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) throw new Error('with-variant-manifest: no <application> in AndroidManifest.xml');
    for (const activity of app.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((d) => !foreignScheme(d.$?.['android:scheme']));
      }
    }
    if (optionalFeatures.length > 0) {
      const features = (manifest['uses-feature'] ?? []).filter((f) => !optionalFeatures.includes(f.$?.['android:name']));
      for (const name of optionalFeatures) features.push({ $: { 'android:name': name, 'android:required': 'false' } });
      manifest['uses-feature'] = features;
    }
    return mod;
  });
};
module.exports.moveBundleId = moveBundleId;
