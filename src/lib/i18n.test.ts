import { getLanguage, makeT, setLanguage, translate } from './i18n';

describe('i18n shim', () => {
  it('re-exports the app resolver', () => {
    expect(translate('en', 'cards.title')).toBe('Cards');
    expect(typeof makeT('en')).toBe('function');
    expect(typeof getLanguage()).toBe('string');
    expect(typeof setLanguage).toBe('function');
  });
});
