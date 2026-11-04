/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { createCard } from '@/db/cards';
import { createCategory } from '@/db/categories';
import { migrate } from '@/db/migrations';
import { readZip } from '@/engine/zip';

import { buildExport, exportFileName, formatSize, type ExportDeps } from './export';
import { readIncomingFile } from './receive';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

async function wallet() {
  const db = createTestDb();
  await migrate(db);
  const food = await createCategory(db, 'Food', 1);
  await createCard(db, { id: 'a', name: 'Nordmarkt', number: '4006381333931', format: 'ean13', color: '#1f6f43', hasFront: true, categoryIds: [food] }, 10);
  await createCard(db, { id: 'b', name: 'Kaffee', number: 'CARD-1', format: 'qr', color: '#6b2fa0', archived: true }, 20);
  await createCard(db, { id: 'c', name: 'No number', number: '', format: 'none', color: '#000000' }, 30);
  return db;
}

const deps = (png: Uint8Array | 'throw' = PNG): ExportDeps & { pngCalls: string[] } => {
  const pngCalls: string[] = [];
  return {
    pngCalls,
    async readPhoto() {
      return JPEG;
    },
    async photoAsPng(id, side) {
      pngCalls.push(`${id}/${side}`);
      if (png === 'throw') throw new Error('no codec');
      return png;
    },
  };
};

describe('export file names (SPEC §5.4 as amended by D47.10; B3 BW-01…06)', () => {
  it('backup: tillcard-backup-<YYYY-MM-DD>.zip; Catima and CSV the same shape', () => {
    const t = Date.UTC(2026, 9, 26, 12, 0, 0);
    expect(exportFileName('backup', t)).toBe('tillcard-backup-2026-10-26.zip');
    expect(exportFileName('catima', t)).toBe('tillcard-catima-2026-10-26.zip');
    expect(exportFileName('csv', t)).toBe('tillcard-cards-2026-10-26.csv');
  });
  it('the date is the UTC calendar day of the export (zero-padded), the same on every phone', () => {
    expect(exportFileName('backup', Date.UTC(2027, 0, 5, 0, 0, 0))).toBe('tillcard-backup-2027-01-05.zip');
    expect(exportFileName('backup', Date.UTC(2027, 0, 5, 23, 59, 59, 999))).toBe('tillcard-backup-2027-01-05.zip');
    expect(exportFileName('backup', Date.UTC(2027, 0, 6))).toBe('tillcard-backup-2027-01-06.zip');
    expect(exportFileName('backup', Date.UTC(2028, 1, 29, 8))).toBe('tillcard-backup-2028-02-29.zip');
  });
  it('a backup built by the export flow carries that name and reads back as our backup', async () => {
    const db = await wallet();
    const r = await buildExport(db, 'backup', deps(), Date.UTC(2026, 9, 26, 9));
    expect(r.fileName).toBe('tillcard-backup-2026-10-26.zip');
    expect(r.fileName).toMatch(/^tillcard-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(r.mimeType).toBe('application/zip');
    expect(readIncomingFile(r.bytes).cards).toHaveLength(3);
  });
});

describe('export (U7) with exact reports', () => {
  it('Catima zip: photos converted to PNG, a card without a number omitted and reported, archived included', async () => {
    const db = await wallet();
    const d = deps();
    const r = await buildExport(db, 'catima', d, Date.UTC(2026, 9, 26));
    expect(r.fileName).toBe('tillcard-catima-2026-10-26.zip');
    expect(d.pngCalls).toEqual(['a/front']);
    expect(Object.keys(readZip(r.bytes)).sort()).toEqual(['card_1_front.png', 'catima.csv']);
    expect([r.exported, r.omitted.map((o) => o.name), r.dropped, r.photoFailures, r.photos]).toEqual([2, ['No number'], [], 0, 1]);
    const back = readIncomingFile(r.bytes);
    expect(back.cards.map((c) => c.name)).toEqual(['Nordmarkt', 'Kaffee']);
    expect(back.cards[0].categories).toEqual(['Food']);
  });

  it('Catima zip: a photo that cannot be converted is left out and counted; a JPEG is never written as .png', async () => {
    const db = await wallet();
    const failed = await buildExport(db, 'catima', deps('throw'));
    expect([failed.photoFailures, failed.photos]).toEqual([1, 0]);
    expect(Object.keys(readZip(failed.bytes))).toEqual(['catima.csv']);
    const jpegBack = await buildExport(db, 'catima', deps(JPEG));
    expect(Object.keys(readZip(jpegBack.bytes))).toEqual(['catima.csv']);
    expect(jpegBack.dropped.map((x) => [x.name, x.field, x.value])).toEqual([['Nordmarkt', 'image', 'front']]);
  });

  it('own backup round-trips every card with its JPEG; one card for Send as file; CSV', async () => {
    const db = await wallet();
    const all = await buildExport(db, 'backup', deps());
    const back = readIncomingFile(all.bytes);
    expect(back.cards.map((c) => c.name)).toEqual(['Nordmarkt', 'Kaffee', 'No number']);
    expect(back.cards[0].images.front).toEqual(JPEG);
    const one = await buildExport(db, 'backup', deps(), 1, ['b']);
    expect(readIncomingFile(one.bytes).cards.map((c) => c.name)).toEqual(['Kaffee']);
    const csv = await buildExport(db, 'csv', deps(), Date.UTC(2026, 0, 2));
    expect(csv.fileName).toBe(exportFileName('csv', Date.UTC(2026, 0, 2)));
    expect(readIncomingFile(csv.bytes).cards).toHaveLength(2); // the generic CSV reader skips the card without a number
    expect([formatSize(900), formatSize(2048), formatSize(3 * 1024 * 1024)]).toEqual(['900 B', '2.0 KB', '3.0 MB']);
  });
});
