/**
 * @jest-environment node
 */
// SPEC §9 / D55: the Add/Edit draft round trip through the `draft_card` setting.
import { createTestDb } from '../../test/node-sqlite-db';

import { migrate } from '@/db/migrations';
import { clearDraftCard, getSettings, loadDraftCard, saveDraftCard, updateSetting } from '@/db/settings';
import { draftApplies, EMPTY_FIELDS, fieldsKey, parseDraft, serialiseDraft, type EditDraft } from './draft';

async function freshDb() {
  const db = await createTestDb();
  await migrate(db);
  return db;
}

const draft = (over: Partial<EditDraft> = {}): EditDraft => ({
  v: 1,
  target: 'new',
  baseUpdatedAt: null,
  savedAt: 1_700_000_000_000,
  fields: { ...EMPTY_FIELDS, name: 'Edeka', number: '4006381333931', format: 'ean13', color: '#c0392b', categoryIds: ['c1'], note: 'Tuesday 10 %', expiry: '2027-12-31' },
  ...over,
});

describe('draft round trip', () => {
  it('saves, loads the same fields and clears', async () => {
    const db = await freshDb();
    expect(await loadDraftCard(db)).toBeNull();
    await saveDraftCard(db, draft());
    expect(await loadDraftCard(db)).toEqual(draft());
    // the typed settings read sees the raw text, unchanged (the setting is the one in SPEC §4.2)
    expect((await getSettings(db)).draftCard).toBe(serialiseDraft(draft()));
    await saveDraftCard(db, draft({ fields: { ...draft().fields, name: 'Edeka Süd' } }));
    expect((await loadDraftCard(db))?.fields.name).toBe('Edeka Süd'); // one slot, overwritten
    await clearDraftCard(db);
    expect(await loadDraftCard(db)).toBeNull();
    expect((await getSettings(db)).draftCard).toBeNull();
  });

  it('keeps an Edit draft for its card only, and only while the card is unchanged', () => {
    const edit = draft({ target: 'card-1', baseUpdatedAt: 500 });
    expect(draftApplies(edit, 'card-1', 500)).toBe(true);
    expect(draftApplies(edit, 'card-2', 500)).toBe(false); // another card
    expect(draftApplies(edit, 'new', null)).toBe(false); // the Add form
    expect(draftApplies(edit, 'card-1', 501)).toBe(false); // card saved since (e.g. from another path)
    expect(draftApplies(null, 'new', null)).toBe(false);
  });

  it('garbage, other versions and wrong shapes read as no draft (never throw)', async () => {
    const db = await freshDb();
    for (const raw of ['', 'not json', '{"name":"x"}', '[]', 'null', JSON.stringify({ ...draft(), v: 2 }), JSON.stringify({ ...draft(), target: '' })]) {
      await updateSetting(db, 'draftCard', raw);
      expect(await loadDraftCard(db)).toBeNull();
    }
    const bad = draft();
    for (const mutate of [
      (d: Record<string, unknown>) => ((d.fields as Record<string, unknown>).format = 'qr-code-9000'),
      (d: Record<string, unknown>) => ((d.fields as Record<string, unknown>).name = 42),
      (d: Record<string, unknown>) => ((d.fields as Record<string, unknown>).categoryIds = [1]),
      (d: Record<string, unknown>) => ((d.fields as Record<string, unknown>).differs = 'yes'),
      (d: Record<string, unknown>) => (d.baseUpdatedAt = 'x'),
    ]) {
      const copy = JSON.parse(JSON.stringify(bad)) as Record<string, unknown>;
      mutate(copy);
      expect(parseDraft(JSON.stringify(copy))).toBeNull();
    }
  });

  it('fieldsKey tells a typed form from the opening state', () => {
    expect(fieldsKey(EMPTY_FIELDS)).toBe(fieldsKey({ ...EMPTY_FIELDS }));
    expect(fieldsKey(EMPTY_FIELDS)).not.toBe(fieldsKey({ ...EMPTY_FIELDS, number: '1' }));
  });
});
