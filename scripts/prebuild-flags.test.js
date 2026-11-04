// D10: when native.sh may run `expo prebuild --clean` on its own (variant switch only), and when it must not.
const { decide, parseMarker } = require('./prebuild-flags');

test('no earlier prebuild: --no-clean, nothing deleted', () => {
  const r = decide({ platform: 'ios', variant: 'preview', previousVariant: null });
  expect(r).toMatchObject({ flags: '--no-clean', deletes: false });
});

test('same variant as the last prebuild: --no-clean', () => {
  const r = decide({ platform: 'android', variant: 'development', previousVariant: 'development' });
  expect(r).toMatchObject({ flags: '--no-clean', deletes: false });
});

test('variant switch: --clean for that platform, and the reason names the folder, both variants and the opt-out', () => {
  const r = decide({ platform: 'android', variant: 'preview', previousVariant: 'development' });
  expect(r).toMatchObject({ flags: '--clean', deletes: true });
  expect(r.reason).toMatch(/android\/ was generated for "development", now building "preview"/);
  expect(r.reason).toContain('PREBUILD_KEEP_ON_VARIANT_SWITCH=1');
});

test('PREBUILD_KEEP_ON_VARIANT_SWITCH=1 keeps the folder on a variant switch', () => {
  const r = decide({ platform: 'ios', variant: 'production', previousVariant: 'preview', env: { PREBUILD_KEEP_ON_VARIANT_SWITCH: '1' } });
  expect(r).toMatchObject({ flags: '--no-clean', deletes: false });
  expect(r.reason).toContain('keeping the folder');
});

test('PREBUILD_FLAGS wins over everything and is passed verbatim', () => {
  expect(decide({ platform: 'ios', variant: 'preview', previousVariant: 'development', env: { PREBUILD_FLAGS: '--no-clean' } })).toMatchObject({ flags: '--no-clean', deletes: false });
  expect(decide({ platform: 'ios', variant: 'preview', previousVariant: 'preview', env: { PREBUILD_FLAGS: '--clean' } })).toMatchObject({ flags: '--clean', deletes: true });
  // an empty value means "not set"
  expect(decide({ platform: 'ios', variant: 'preview', previousVariant: 'development', env: { PREBUILD_FLAGS: '' } })).toMatchObject({ flags: '--clean' });
});

test('the marker written by native.sh is "<variant> <hash>"; the variant is its first word', () => {
  expect(parseMarker('development 3f2a9c1b0d7e\n')).toBe('development');
  expect(parseMarker('  preview\n')).toBe('preview');
  expect(parseMarker('')).toBeNull();
  expect(parseMarker(undefined)).toBeNull();
});
