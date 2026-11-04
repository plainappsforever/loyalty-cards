/**
 * @jest-environment node
 */
// A4 part 1: the dev fixtures (our writer's zip and a hand-written v1 CSV) and the hand-written v2 export (P4c, review S11)
// import with exactly the expected summaries.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { colorForName } from './color';

import { planImport } from '../import-plan';

import { readCatima } from './reader';

const dir = join(__dirname, '../../../test/fixtures/catima/dev');

describe('Catima dev fixtures', () => {
  it('sample-v2.zip: 45 rows → 44 imported + 1 duplicate skipped, groups and images attached', () => {
    const r = readCatima(new Uint8Array(readFileSync(join(dir, 'sample-v2.zip'))));
    const want = JSON.parse(readFileSync(join(dir, 'sample-v2.expected.json'), 'utf8'));
    expect(r.version).toBe(2);
    expect(r.cards).toHaveLength(want.cards);
    expect(r.skipped).toEqual([]);
    expect(r.groups).toEqual(want.groups);
    expect(r.cards.filter((c) => c.images.front).length).toBe(want.imagesFront);
    const counts: Record<string, number> = {};
    for (const c of r.cards) counts[c.format] = (counts[c.format] ?? 0) + 1;
    expect(counts).toEqual(want.formats);
    const plan = planImport(r.cards, [], r.skipped);
    expect(plan.summary).toEqual({ imported: want.cards - want.duplicatesInFile, skipped: 0, duplicates: want.duplicatesInFile });
    expect(r.cards[0].name).toBe('Nordmarkt 0');
    expect(r.cards[2].name).toBe('Çağdaş Market 2');
    expect(r.cards[6].name).toBe('お店 6');
  });

  it('sample-v1.csv: 7 rows → 5 imported, 2 skipped with row numbers and reasons; fields as expected', () => {
    const r = readCatima(new Uint8Array(readFileSync(join(dir, 'sample-v1.csv'))));
    const want = JSON.parse(readFileSync(join(dir, 'sample-v1.expected.json'), 'utf8'));
    expect(r.version).toBe(want.version);
    expect(r.cards).toHaveLength(want.imported);
    expect(r.skipped).toEqual(want.skipped);
    want.cards.forEach((w: Record<string, unknown>, i: number) => expect(r.cards[i]).toMatchObject(w));
  });

  it('handwritten/catima.csv (typed from Catima\'s documented format, NOT by our writer) imports exactly as hand-expected', () => {
    const hw = join(__dirname, '../../../test/fixtures/catima/handwritten');
    const want = JSON.parse(readFileSync(join(hw, 'expected.json'), 'utf8'));
    const csv = readFileSync(join(hw, 'catima.csv'), 'utf8');
    expect(csv.includes('\r\n')).toBe(true);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const zip = zipSync({ 'catima.csv': strToU8(csv), 'card_1_front.png': [png, { level: 0 }], 'card_2_icon.png': [png, { level: 0 }] });
    const r = readCatima(zip);
    expect(r.version).toBe(2);
    expect(r.cards).toHaveLength(want.read);
    expect(r.skipped).toEqual(want.skipped);
    expect(r.invalidCodes).toBe(want.invalidCodes);
    expect(r.groups).toEqual(want.groups);
    want.cards.forEach((w: Record<string, unknown>, i: number) => expect({ i, ...r.cards[i] }).toMatchObject({ i, ...w }));
    expect(r.cards[4].color).toBe(colorForName('Parcel Locker')); // empty headercolor → colour from the name
    expect(r.cards.map((c, i) => (c.images.front ? i : -1)).filter((i) => i >= 0)).toEqual(want.imagesFront);
    expect(r.cards.map((c, i) => (c.images.icon ? i : -1)).filter((i) => i >= 0)).toEqual(want.imagesIcon);
    expect(planImport(r.cards, [], r.skipped).summary).toEqual(want.summary);
  });
});
