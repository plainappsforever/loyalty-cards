// P9 (RELEASE_KIT 1b step 5/8; the Dimmer pattern of 2026-10-26, print-cost D84 for the Expo side): Android release
// builds are signed with the owner's upload key when a properties file OUTSIDE the repo exists, by default
// ~/Developer/.keys/loyalty-cards-release.properties (override: Gradle property `-Ployaltycards.uploadProperties=<path>`
// or the environment variable LOYALTY_CARDS_UPLOAD_PROPERTIES). It holds storeFile, storePassword, keyAlias,
// keyPassword; a relative storeFile is read next to the properties file. Without the file (or with one of the four values
// missing, or the key file absent) the release build stays signed with the DEBUG key, exactly as before, and Gradle prints
// a warning: such a build is for the emulator only, Play refuses it. Nothing from the file is printed or copied.
// Claude never creates, sees or commits the key: the owner runs the `keytool` line in docs/RELEASE_KIT.md (1b step 8).
// Idempotent: `expo prebuild --no-clean` re-applies mods to the existing build.gradle. Pinned by
// plugins/release-signing.test.js; the production build of P9 checked the fallback and the upload path (V1_LOG P9).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// loyalty-cards: release signing (plugins/with-release-signing.js)';

const LOAD = `${MARK}
def lcUploadPath = findProperty('loyaltycards.uploadProperties') ?: System.getenv('LOYALTY_CARDS_UPLOAD_PROPERTIES') ?: (System.getProperty('user.home') + '/Developer/.keys/loyalty-cards-release.properties')
def lcUploadFile = new File(lcUploadPath)
def lcUpload = null
if (lcUploadFile.isFile()) {
    def p = new Properties()
    lcUploadFile.withInputStream { p.load(it) }
    def complete = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'].every { p.getProperty(it)?.trim() }
    def store = complete ? new File(p.getProperty('storeFile')) : null
    if (store != null && !store.isAbsolute()) store = new File(lcUploadFile.parentFile, p.getProperty('storeFile'))
    if (store != null && store.isFile()) lcUpload = [store: store, props: p]
}
if (lcUpload == null) {
    logger.warn("loyalty-cards: release key properties not found or incomplete at \${lcUploadPath} - the RELEASE build is signed with the DEBUG key (emulator testing only, not uploadable to Google Play).")
}

android {`;

const CONFIG = `
        if (lcUpload != null) {
            upload {
                storeFile lcUpload.store
                storePassword lcUpload.props.getProperty('storePassword')
                keyAlias lcUpload.props.getProperty('keyAlias')
                keyPassword lcUpload.props.getProperty('keyPassword')
            }
        }`;

const USE = "signingConfig signingConfigs.findByName('upload') ?: signingConfigs.debug";

function apply(src) {
  if (src.includes(MARK)) return src;
  let out = src.replace(/^android \{/m, LOAD);
  // after the template's debug signing config
  out = out.replace(/(signingConfigs \{\n\s*debug \{[\s\S]*?\n\s*\})\n/, `$1${CONFIG}\n`);
  // the template's release build type: its debug signing line (the first one after "release {" inside buildTypes)
  out = out.replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, `$1${USE}`);
  if (!out.includes(MARK) || !out.includes('upload {') || !out.includes(USE)) {
    throw new Error('with-release-signing: android/app/build.gradle layout not recognised');
  }
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = apply(mod.modResults.contents);
    return mod;
  });
};
module.exports.apply = apply;
module.exports.MARK = MARK;
