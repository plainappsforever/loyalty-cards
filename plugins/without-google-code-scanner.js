// P5 (D40; copy of price-book plugins/without-google-code-scanner.js, its D65): keeps Google's code scanner
// (com.google.android.gms:play-services-code-scanner) out of the Android app. expo-camera ships it for `launchScanner()`,
// whose scanner module Google Play services downloads on first use
// (https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner). We never call launchScanner(): live scanning is
// CameraView (ML Kit barcode-scanning with the model BUNDLED in the app, offline from the first scan) and still images go
// through modules/code-kit (the same bundled ML Kit library). Only that one dependency is excluded. Every variant, so the
// development build tests the same app. Idempotent: prebuild --no-clean keeps the old build.gradle.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// loyalty-cards: without-google-code-scanner';
const BLOCK = `
${MARKER}
configurations.configureEach {
    exclude group: 'com.google.android.gms', module: 'play-services-code-scanner'
}
`;

module.exports = function withoutGoogleCodeScanner(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(MARKER)) mod.modResults.contents += BLOCK;
    return mod;
  });
};
module.exports.MARKER = MARKER;
