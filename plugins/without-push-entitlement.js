// P8b (interval-timer P8 / pdf-scanner P10b): the app sends no notifications and uses no push, but expo-widgets 57
// (plugin/build/ios/withPushNotifications.js) writes `aps-environment = development` into the iOS entitlements even with
// enablePushNotifications false. The key would add the Push capability to the App ID at the first device build and invite a
// review question. Removed here; listed early in app.config.ts so it runs after expo-widgets (mods run last-registered-first).
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
