import { de } from './de';
import { en, type MessageKey } from './en';
import { languageOfTag, LANGUAGE_NAMES, LANGUAGES, makeT, messages, resolveLanguage, translate } from './index';

const placeholders = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(' ');

describe('i18n parity', () => {
  it('every complete language has exactly the English keys, no empty text and the same placeholders', () => {
    for (const [lang, dict] of Object.entries(messages)) {
      expect({ lang, keys: Object.keys(dict!).sort() }).toEqual({ lang, keys: Object.keys(en).sort() });
      for (const [key, text] of Object.entries(en)) {
        const value = dict![key as MessageKey];
        expect({ lang, key, empty: value.trim() === '' }).toEqual({ lang, key, empty: false });
        expect({ lang, key, p: placeholders(value) }).toEqual({ lang, key, p: placeholders(text) });
      }
    }
  });

  it('German is complete and actually translated (not English copies, except the name and loanwords)', () => {
    const same = (Object.keys(en) as MessageKey[]).filter((k) => de[k] === en[k]);
    expect(same.sort()).toEqual(['app.name', 'common.ok', 'settings.widgets', 'settings.theme.system', 'settings.version'].sort()); // "Widgets" is German too
  });

  it('keeps the app name untranslated', () => {
    for (const dict of Object.values(messages)) expect(dict!['app.name']).toBe(en['app.name']);
  });

  it('offers 15 UI languages with a name each, every one with a complete dictionary (13 machine drafts, P7)', () => {
    expect(LANGUAGES).toHaveLength(15);
    for (const l of LANGUAGES) expect(LANGUAGE_NAMES[l].length).toBeGreaterThan(0);
    expect(Object.keys(messages).sort()).toEqual([...LANGUAGES].sort());
    expect(translate('fr', 'cards.title')).toBe('Cartes');
    // outside en/de a count is "Label: {n}" — no singular|plural pair the en/de picker would split
    for (const [lang, dict] of Object.entries(messages)) if (lang !== 'en' && lang !== 'de') for (const text of Object.values(dict!)) expect(text).not.toContain('|');
    expect(translate('de', 'cards.title')).toBe(de['cards.title']);
  });
});

describe('language resolution', () => {
  it('maps device tags', () => {
    expect(languageOfTag('de-AT')).toBe('de');
    expect(languageOfTag('pt-PT')).toBe('pt-BR');
    expect(languageOfTag('zh-Hant-TW')).toBeUndefined();
    expect(languageOfTag('zh-CN')).toBe('zh-CN');
    expect(languageOfTag('in')).toBe('id');
    expect(languageOfTag('xx')).toBeUndefined();
  });
  it('preference wins, then the first spoken device language, then English', () => {
    expect(resolveLanguage('tr', ['de-DE'])).toBe('tr');
    expect(resolveLanguage('system', ['zh-TW', 'ja-JP'])).toBe('ja');
    expect(resolveLanguage('system', [])).toBe('en');
  });
});

describe('translate', () => {
  it('fills placeholders and picks singular/plural', () => {
    expect(translate('en', 'cards.count', { n: 1 })).toBe('1 card');
    expect(translate('en', 'cards.count', { n: 3 })).toBe('3 cards');
    expect(translate('de', 'debug.seedDone', { n: 200 })).toBe('200 Karten geladen');
  });
  it('makeT keeps one identity per language (React Compiler rule)', () => {
    expect(makeT('en')).toBe(makeT('en'));
    expect(makeT('en')).not.toBe(makeT('de'));
  });
});
