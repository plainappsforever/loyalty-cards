// No Firebase push in the merged Android manifest (meter-tracker D73, invoice-maker D89, mood-journal D70, template D10).
// expo-notifications (used for LOCAL notifications) links Firebase Cloud Messaging for push, so the merged manifest carries
// Firebase's push service, instance-id receiver, init provider, component discovery and the datatransport (upload) services.
// An app without push and without google-services.json gains nothing from them; removing the entries keeps the Play
// SDK / Data-safety picture honest. The library code stays linked (it cannot be removed without patching expo-notifications);
// only these manifest entries go, through `tools:node="remove"` in the manifest merge.
// Also removed: the Play install-referrer binding permission (installreferrer comes with expo-application, a dependency of
// expo-notifications; nothing in the template asks for the install referrer).
// Registered for EVERY variant, so the dev notification flow proves local notifications still work without these entries.
// Remove this plugin from app.config.ts the day an app adds push.
const { withAndroidManifest } = require('expo/config-plugins');

const REMOVED_COMPONENTS = {
  service: [
    'expo.modules.notifications.service.ExpoFirebaseMessagingService',
    'com.google.firebase.messaging.FirebaseMessagingService',
    'com.google.firebase.components.ComponentDiscoveryService',
    'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery',
    'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService',
  ],
  receiver: [
    'com.google.firebase.iid.FirebaseInstanceIdReceiver',
    'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver',
  ],
  provider: ['com.google.firebase.provider.FirebaseInitProvider'],
};
const REMOVED_PERMISSIONS = ['com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'];

function withoutFirebasePush(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const app = manifest.application?.[0];
    if (!app) throw new Error('without-firebase-push: no <application> in AndroidManifest.xml');
    for (const [tag, names] of Object.entries(REMOVED_COMPONENTS)) {
      const kept = (app[tag] ?? []).filter((c) => !names.includes(c.$?.['android:name']));
      for (const name of names) kept.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
      app[tag] = kept;
    }
    const perms = (manifest['uses-permission'] ?? []).filter((p) => !REMOVED_PERMISSIONS.includes(p.$?.['android:name']));
    for (const name of REMOVED_PERMISSIONS) perms.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    manifest['uses-permission'] = perms;
    return cfg;
  });
}

module.exports = withoutFirebasePush;
module.exports.REMOVED_COMPONENTS = REMOVED_COMPONENTS;
module.exports.REMOVED_PERMISSIONS = REMOVED_PERMISSIONS;
