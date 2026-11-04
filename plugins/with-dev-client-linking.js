// loyalty-cards P8a (copied from pdf-scanner REVIEW_V1 N1, port of print-cost D83): preview/production builds on iOS link NO development client (Android: see below). expo-dev-client (with
// expo-dev-launcher, expo-dev-menu and expo-dev-menu-interface) is a dependency of the project, so autolinking would
// compile it into every variant (without-dev-client-residue.js strips its manifest keys, but its classes and EX_DEV_CLIENT_NETWORK_INSPECTOR
// stay). Release variants exclude those four packages from autolinking (Gradle settings and Podfile) and turn the
// network inspector property off; the development variant removes the exclusion again. Applied to EVERY variant on
// purpose: `expo prebuild --no-clean` keeps the files an earlier prebuild of another variant wrote (deletion rule).
const { withGradleProperties, withPodfile, withSettingsGradle } = require('expo/config-plugins');

const PACKAGES = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
const MARK = '// loyaltycards: release variants link no development client (plugins/with-dev-client-linking.js)';
const GRADLE_LINE = `expoAutolinking.exclude = [${PACKAGES.map((p) => `"${p}"`).join(', ')}] ${MARK}`;
const POD_MARK = '# loyaltycards: release variants link no development client (plugins/with-dev-client-linking.js)';
const POD_CALL = `use_expo_modules!(exclude: [${PACKAGES.map((p) => `'${p}'`).join(', ')}]) ${POD_MARK}`;

function settings(src, release) {
  const lines = src.split('\n').filter((l) => !l.includes(MARK));
  let out = lines.join('\n');
  if (release) {
    if (!out.includes('expoAutolinking.useExpoModules()')) throw new Error('with-dev-client-linking: settings.gradle layout not recognised');
    out = out.replace('expoAutolinking.useExpoModules()', `${GRADLE_LINE}\nexpoAutolinking.useExpoModules()`);
  }
  return out;
}

function podfile(src, release) {
  let out = src.replace(new RegExp(`use_expo_modules!\\(exclude: \\[[^\\]]*\\]\\) ${POD_MARK.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), 'use_expo_modules!');
  if (release) {
    if (!/^[ \t]*use_expo_modules![ \t]*$/m.test(out)) throw new Error('with-dev-client-linking: Podfile layout not recognised');
    out = out.replace(/^([ \t]*)use_expo_modules![ \t]*$/m, `$1${POD_CALL}`);
  }
  return out;
}

module.exports = function withDevClientLinking(config, { release }) {
  // Android keeps the modules linked (fallback, print-cost D83): excluding them changed Gradle's configuration order so that
  // react-native-worklets' build.gradle.kts no longer compiled (Kotlin/AGP classes unresolved; same failure twice). On
  // Android expo-dev-launcher and expo-dev-menu compile their `disableInRelease` source sets in release builds instead,
  // and without-dev-client-residue.js strips their manifest keys. The settings mod still REMOVES an old exclude line.
  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = settings(mod.modResults.contents, false);
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    const item = mod.modResults.find((i) => i.type === 'property' && i.key === 'EX_DEV_CLIENT_NETWORK_INSPECTOR');
    if (item) item.value = release ? 'false' : 'true';
    return mod;
  });
  return withPodfile(config, (mod) => {
    mod.modResults.contents = podfile(mod.modResults.contents, release);
    return mod;
  });
};
module.exports.settings = settings;
module.exports.podfile = podfile;
