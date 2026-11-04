// P9: the release-signing mod on the prebuild template's real android/app/build.gradle (node_modules/expo/template.tgz).
const { execFileSync } = require('child_process');
const path = require('path');

const { apply, MARK } = require('./with-release-signing');

function templateGradle() {
  const tgz = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
  return execFileSync('tar', ['-xOzf', tgz, 'package/android/app/build.gradle'], { encoding: 'utf8' });
}

function blockOf(src, start) {
  // the text from `start` to its matching closing brace
  const i = src.indexOf(start);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`unclosed ${start}`);
}

test('release uses the upload key when present, else debug; debug build type untouched; key path outside the repo', () => {
  const before = templateGradle();
  const out = apply(before);
  expect(out).toContain(MARK);
  const buildTypes = blockOf(out, 'buildTypes {');
  expect(blockOf(buildTypes, 'release {')).toContain("signingConfig signingConfigs.findByName('upload') ?: signingConfigs.debug");
  expect(blockOf(buildTypes, 'debug {')).toContain('signingConfig signingConfigs.debug');
  const signing = blockOf(out, 'signingConfigs {');
  expect(signing).toContain("storeFile file('debug.keystore')");
  expect(signing).toContain('if (lcUpload != null) {');
  // the default file lives under ~/Developer/.keys, never in the project; a Gradle property / env var can point elsewhere
  expect(out).toContain("'/Developer/.keys/loyalty-cards-release.properties'");
  expect(out).toContain("findProperty('loyaltycards.uploadProperties')");
  expect(out).toContain("System.getenv('LOYALTY_CARDS_UPLOAD_PROPERTIES')");
  // Groovy interpolation survives (no JS template leak), and the warning names the fallback
  expect(out).toContain('${lcUploadPath}');
  expect(out).toContain('signed with the DEBUG key');
  // the loader sits before `android {`, exactly one android block
  expect(out.indexOf(MARK)).toBeLessThan(out.indexOf('\nandroid {'));
  expect(out.match(/^android \{/gm)).toHaveLength(1);
  // nothing else changed: taking the three insertions out gives the template back
  const undone = out
    .replace(/[^\n]*loyalty-cards: release signing[\s\S]*?\nandroid \{/, 'android {')
    .replace(/\n\s*if \(lcUpload != null\) \{\n\s*upload \{[\s\S]*?\n\s*\}\n\s*\}/, '')
    .replace("signingConfig signingConfigs.findByName('upload') ?: signingConfigs.debug", 'signingConfig signingConfigs.debug');
  expect(undone).toBe(before);
});

test('idempotent (prebuild --no-clean re-applies mods) and loud on an unknown layout', () => {
  const once = apply(templateGradle());
  expect(apply(once)).toBe(once);
  expect(() => apply('android {\n}\n')).toThrow('layout not recognised');
});

test('registered for every variant (release build types only use it)', () => {
  for (const variant of ['development', 'preview', 'production']) {
    let cfg;
    jest.isolateModules(() => {
      const before = process.env.APP_VARIANT;
      process.env.APP_VARIANT = variant;
      try {
        cfg = require('../app.config.ts').default({ config: {} });
      } finally {
        if (before === undefined) delete process.env.APP_VARIANT;
        else process.env.APP_VARIANT = before;
      }
    });
    expect(cfg.plugins).toContain('./plugins/with-release-signing.js');
  }
});
