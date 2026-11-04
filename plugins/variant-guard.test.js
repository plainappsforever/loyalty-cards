// F1 / D54 (review 2026-10-26): a store build made without APP_VARIANT embeds the DEVELOPMENT config (scheme loyaltycards-dev,
// test routes open). Four guards, each pinned here:
//  1. app.config.ts refuses a Release Xcode build (CONFIGURATION=Release) when APP_VARIANT is unset;
//  2. the test-route gates are closed unless the variant is explicitly preview/development (src/lib/variant.ts) and no
//     `!== 'production'` gate is left in src/;
//  3. every archive/build command in docs/RELEASE_KIT.md carries APP_VARIANT=;
//  4. scripts/check-variant.sh exists (the read-back of a built binary) and the kit tells the owner to run it.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadConfig(env) {
  let cfg;
  const keys = ['APP_VARIANT', 'CONFIGURATION'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    jest.isolateModules(() => {
      cfg = require('../app.config.ts').default({ config: {} });
    });
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
  return cfg;
}

describe('app.config.ts variant guard', () => {
  test('Release Xcode build without APP_VARIANT throws', () => {
    expect(() => loadConfig({ CONFIGURATION: 'Release' })).toThrow(/APP_VARIANT is not set in a Release build/);
  });

  test('Release with APP_VARIANT is fine and keeps the variant', () => {
    expect(loadConfig({ CONFIGURATION: 'Release', APP_VARIANT: 'production' }).extra.appVariant).toBe('production');
    expect(loadConfig({ CONFIGURATION: 'Release', APP_VARIANT: 'preview' }).extra.appVariant).toBe('preview');
  });

  test('Debug or no Xcode marker still defaults to development', () => {
    expect(loadConfig({ CONFIGURATION: 'Debug' }).extra.appVariant).toBe('development');
    expect(loadConfig({}).extra.appVariant).toBe('development');
  });
});

describe('explicit build numbers (review F7)', () => {
  test.each(['development', 'preview', 'production'])('%s sets ios.buildNumber and android.versionCode', (variant) => {
    const cfg = loadConfig({ APP_VARIANT: variant });
    expect(cfg.ios.buildNumber).toMatch(/^[1-9][0-9]*$/);
    expect(Number.isInteger(cfg.android.versionCode) && cfg.android.versionCode >= 1).toBe(true);
  });
});

describe('test-route gates fail closed', () => {
  test('no `!== \'production\'` variant gate is left under src/', () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    const offenders = walk(path.join(ROOT, 'src')).filter((f) => /appVariant\s*!==\s*'production'/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('the six screens use testToolsEnabled()', () => {
    const files = ['src/app/debug/seed.tsx', 'src/app/debug/self-test.tsx', 'src/app/debug/decode-set.tsx', 'src/app/add/photo.tsx', 'src/app/settings.tsx', 'src/app/card/[id]/index.tsx'];
    for (const f of files) expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toContain('testToolsEnabled()');
  });
});

// docs/ is private and left out of the public source export: the kit checks run only where the kit exists
const KIT_FILE = path.join(ROOT, 'docs/RELEASE_KIT.md');
(fs.existsSync(KIT_FILE) ? describe : describe.skip)('docs/RELEASE_KIT.md build commands', () => {
  const kit = fs.existsSync(KIT_FILE) ? fs.readFileSync(KIT_FILE, 'utf8') : '';
  // a command that compiles a store/preview binary: xcodebuild archive/Release, gradlew bundle/assemble, expo run
  const BUILD = /(xcodebuild[^|]*(\barchive\b|-configuration Release)|gradlew\b[^|]*(bundle|assemble)|expo run:)/;

  test('every archive/build command is prefixed with APP_VARIANT=', () => {
    const commands = [...kit.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((c) => BUILD.test(c));
    expect(commands.length).toBeGreaterThan(0);
    const bad = commands.filter((c) => !/\bAPP_VARIANT=(production|preview)\b/.test(c));
    expect(bad).toEqual([]);
  });

  test('the kit tells the owner to read the config back with scripts/check-variant.sh', () => {
    expect(kit).toContain('scripts/check-variant.sh');
    expect(fs.existsSync(path.join(ROOT, 'scripts/check-variant.sh'))).toBe(true);
  });
});
