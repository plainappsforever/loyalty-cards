/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';
import { createCard, getCard, listCards } from '@/db/cards';
import { getCodeCache } from '@/db/code-cache';
import { listCategories } from '@/db/categories';
import { migrate } from '@/db/migrations';
import { writeBackupZip } from '@/engine/backup/writer';
import { buildSharePayload } from '@/engine/share-payload';
import { utf8 } from '@/engine/zip';

import type { FileOps } from './files';
import { countDuplicates, importReceived, type ImportDeps } from './import';
import { readIncomingFile, readIncomingText, ReceiveError } from './receive';

const fixture = (...p: string[]) => new Uint8Array(readFileSync(join(__dirname, '../../test/fixtures', ...p)));

function fakeDeps(failJpeg = false): ImportDeps & { files: Set<string> } {
  const files = new Set<string>();
  let n = 0;
  const fs: FileOps = {
    async move(from, to) {
      if (!files.delete(from)) throw new Error(`missing ${from}`);
      files.add(to);
    },
    async remove(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
    async makeDir() {},
    async list() {
      return [];
    },
  };
  return {
    fs,
    files,
    async toJpeg() {
      if (failJpeg) throw new Error('cannot decode');
      const p = `tmp/${++n}.jpg`;
      files.add(p);
      return p;
    },
  };
}

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('receive: what kind of file or text came in', () => {
  it('reads a Catima v2 zip (45 cards, 2 groups, PNG photos)', () => {
    const r = readIncomingFile(fixture('catima/dev/sample-v2.zip'));
    expect(r.kind).toBe('catima');
    expect(r.cards).toHaveLength(45);
    expect(r.categories).toEqual(['Food', 'Travel']);
    expect(r.images).toBe('png');
    expect(r.cards.filter((c) => c.images.front).length).toBe(5);
  });

  it('reads a Catima v1 CSV, our backup zip, a generic CSV, an LC1 payload; refuses anything else', () => {
    expect(readIncomingFile(fixture('catima/dev/sample-v1.csv')).kind).toBe('catima');
    const backup = writeBackupZip(
      [{ id: 'a', name: 'Nordmarkt', number: '4006381333931', codeValue: '', format: 'ean13', color: '#1f6f43', note: '', balance: '', balanceCurrency: '', validFrom: null, expiry: null, favourite: true, archived: false, lastUsedAt: null, categories: ['Food'], tile: 'initials', chainId: null, useCount: 3, sortIndex: 0, createdAt: 1, updatedAt: 1 }],
      ['Food'],
      1000
    );
    const b = readIncomingFile(backup);
    expect([b.kind, b.images, b.cards[0].extras?.useCount, b.categories]).toEqual(['backup', 'jpeg', 3, ['Food']]);
    const csv = readIncomingFile(utf8.encode('name,number,format\nKaffee,12345678,code128\n'));
    expect([csv.kind, csv.cards[0].name]).toEqual(['csv', 'Kaffee']);
    const payload = buildSharePayload({ name: 'Anna', number: 'CARD-1', codeValue: '', format: 'qr', color: '#123456', note: '', balance: '', balanceCurrency: '', expiry: null, validFrom: null }).text;
    expect(readIncomingFile(utf8.encode(payload)).kind).toBe('payload');
    expect(readIncomingText(payload)?.cards[0].name).toBe('Anna');
    expect(readIncomingText('hello')).toBeNull();
    expect(() => readIncomingFile(utf8.encode('just some words'))).toThrow(ReceiveError);
    expect(() => readIncomingFile(new Uint8Array())).toThrow(ReceiveError);
  });
});

describe('import: never overwrites, exact summary, cache and photos (A13, D42)', () => {
  it('imports the Catima zip: 44 new, the in-file duplicate skipped, groups → categories, 2D caches, photos converted', async () => {
    const db = await freshDb();
    const deps = fakeDeps();
    const r = readIncomingFile(fixture('catima/dev/sample-v2.zip'));
    expect(await countDuplicates(db, r)).toBe(1);
    const s = await importReceived(db, deps, r, 'skip', 5000);
    expect([s.imported, s.skipped, s.duplicates, s.photoFailures]).toEqual([44, 0, 1, 0]);
    expect((await listCategories(db)).map((c) => c.name)).toEqual(['Food', 'Travel']);
    const cards = await listCards(db, 'all');
    expect(cards).toHaveLength(44);
    for (const c of cards.filter((x) => ['qr', 'aztec', 'pdf417', 'datamatrix'].includes(x.format))) expect(await getCodeCache(db, c.id)).not.toBeNull();
    expect(cards.filter((c) => c.hasFront)).toHaveLength(5);
    expect([...deps.files].filter((f) => f.endsWith('/front.jpg'))).toHaveLength(5);

    // the same file again: everything is a duplicate, nothing changes; keepBoth adds them as new cards
    const again = await importReceived(db, deps, r, 'skip', 6000);
    expect([again.imported, again.duplicates]).toEqual([0, 45]);
    const both = await importReceived(db, deps, r, 'keepBoth', 7000);
    expect([both.imported, both.keptDuplicates]).toEqual([45, 45]);
  });

  it('a photo that cannot be converted: the card is imported without it and counted', async () => {
    const db = await freshDb();
    const s = await importReceived(db, fakeDeps(true), readIncomingFile(fixture('catima/dev/sample-v2.zip')), 'skip', 5000);
    expect([s.imported, s.photoFailures]).toEqual([44, 5]);
    expect((await listCards(db, 'all')).filter((c) => c.hasFront)).toHaveLength(0);
  });

  it('an existing card is never overwritten', async () => {
    const db = await freshDb();
    const id = await createCard(db, { name: 'Mine', number: 'CARD-1', format: 'qr', color: '#000000', note: 'keep' }, 1000);
    const payload = buildSharePayload({ name: 'Anna', number: 'CARD-1', codeValue: '', format: 'qr', color: '#123456', note: 'other', balance: '', balanceCurrency: '', expiry: null, validFrom: null }).text;
    const s = await importReceived(db, fakeDeps(), readIncomingText(payload)!, 'skip', 2000);
    expect([s.imported, s.duplicates]).toEqual([0, 1]);
    expect((await getCard(db, id))?.note).toBe('keep');
  });
});
