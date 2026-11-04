// Review F7 (P9): CFBundleLocalizations lists the app's UI languages except Arabic (declaring `ar` mirrors the native
// navigation bar on an Arabic iPhone while the React Native content stays left-to-right; app.config.ts, V1_LOG P9).
const { LANGUAGES } = require('../src/i18n');

function loadConfig(variant) {
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
  return cfg;
}

const appleId = (language) => (language === 'zh-CN' ? 'zh-Hans' : language);

test.each(['development', 'preview', 'production'])('%s: CFBundleLocalizations = the UI languages without Arabic', (variant) => {
  const list = loadConfig(variant).ios.infoPlist.CFBundleLocalizations;
  expect(LANGUAGES).toHaveLength(15);
  expect(list).toEqual(LANGUAGES.filter((l) => l !== 'ar').map(appleId));
  expect(list).toHaveLength(14);
  expect(list).not.toContain('ar');
});
