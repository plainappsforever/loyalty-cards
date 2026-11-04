/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { createCard, deleteCards, getCard, updateCard, UNDO_WINDOW_MS } from '@/db/cards';
import { migrate } from '@/db/migrations';

import { cardDir, photoPaths, planSweep, purgeExpired, replacePhoto, runSweep, storeNewCard, type FileOps } from './files';

/** In-memory file system with injectable failures. */
function fakeFs(fail: { move?: (from: string, to: string) => boolean } = {}) {
  const files = new Set<string>(['tmp/f.jpg', 'tmp/b.jpg', 'tmp/t.jpg', 'tmp/n.jpg']);
  const dirs = new Set<string>();
  const log: string[] = [];
  const ops: FileOps = {
    async move(from, to) {
      if (fail.move?.(from, to)) throw new Error(`disk full moving ${from}`);
      if (!files.has(from)) throw new Error(`missing ${from}`);
      files.delete(from);
      files.add(to);
      log.push(`move ${from} → ${to}`);
    },
    async remove(path) {
      if (!files.has(path) && !dirs.has(path)) throw new Error(`missing ${path}`);
      files.delete(path);
      dirs.delete(path);
      for (const f of [...files]) if (f.startsWith(`${path}/`)) files.delete(f);
      log.push(`remove ${path}`);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path);
    },
    async makeDir(path) {
      dirs.add(path);
    },
    async list(dir) {
      const out = new Set<string>();
      for (const f of [...files, ...dirs]) if (f.startsWith(`${dir}/`)) out.add(f.slice(dir.length + 1).split('/')[0]);
      return [...out];
    },
  };
  return { ops, files, dirs, log };
}

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const card = { id: 'c1', name: 'Nordmarkt', number: '123', format: 'code128' as const, color: '#1f6f43' };

describe('files then rows (SPEC §4.1, A19)', () => {
  it('moves the photos into the card folder BEFORE the row is inserted and sets the flags', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg', back: 'tmp/b.jpg', thumb: 'tmp/t.jpg' }, 1);
    expect(fs.log).toEqual(['move tmp/f.jpg → cards/c1/front.jpg', 'move tmp/b.jpg → cards/c1/back.jpg', 'move tmp/t.jpg → cards/c1/thumb.jpg']);
    expect(await getCard(db, 'c1')).toMatchObject({ hasFront: true, hasBack: true });
    expect(photoPaths('c1')).toEqual({ front: 'cards/c1/front.jpg', back: 'cards/c1/back.jpg', thumb: 'cards/c1/thumb.jpg' });
    expect(() => cardDir('../x')).toThrow('unsafe');
  });

  it('a failed move (disk full) creates no row and takes back what this call moved', async () => {
    const fs = fakeFs({ move: (from) => from === 'tmp/b.jpg' });
    const db = await freshDb();
    await expect(storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg', back: 'tmp/b.jpg' })).rejects.toThrow('disk full');
    expect(await getCard(db, 'c1')).toBeNull();
    expect(fs.files.has('cards/c1/front.jpg')).toBe(false);
    expect(fs.log).toEqual(['move tmp/f.jpg → cards/c1/front.jpg', 'remove cards/c1/front.jpg']);
  });

  it('a failed insert leaves no orphan folder', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await expect(storeNewCard(fs.ops, db, { ...card, name: '' }, { front: 'tmp/f.jpg' })).rejects.toThrow('card name');
    expect(await getCard(db, 'c1')).toBeNull();
    expect([...fs.files].filter((f) => f.startsWith('cards/'))).toEqual([]);
    expect(fs.dirs.has('cards/c1')).toBe(false);
  });

  it('a card without photos creates no folder', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card);
    expect(fs.log).toEqual([]);
    expect(await getCard(db, 'c1')).toMatchObject({ hasFront: false, hasBack: false });
  });

  it('replacePhoto keeps the old photo when the row update fails; the row is updated LAST (S13)', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg' });
    await expect(replacePhoto(fs.ops, 'c1', 'front', 'tmp/n.jpg', () => updateCard(db, 'c1', { color: 'bad' }))).rejects.toThrow('colour');
    expect(fs.files.has('cards/c1/front.jpg')).toBe(true);
    expect(fs.files.has('cards/c1/front.jpg.new')).toBe(false);
    fs.files.add('tmp/n.jpg');
    await replacePhoto(fs.ops, 'c1', 'front', 'tmp/n.jpg', () => updateCard(db, 'c1', { hasFront: true }));
    expect(fs.log.slice(-4)).toEqual(['move tmp/n.jpg → cards/c1/front.jpg.new', 'move cards/c1/front.jpg → cards/c1/front.jpg.old', 'move cards/c1/front.jpg.new → cards/c1/front.jpg', 'remove cards/c1/front.jpg.old']);
  });

  it('R5: a failed final move restores the old photo; the sweep finishes a parked photo', async () => {
    const fs = fakeFs({ move: (from) => from === 'cards/c1/front.jpg.new' });
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg' });
    await expect(replacePhoto(fs.ops, 'c1', 'front', 'tmp/n.jpg', () => updateCard(db, 'c1', { hasFront: true }))).rejects.toThrow('disk full');
    expect(fs.files.has('cards/c1/front.jpg')).toBe(true); // old photo back in place
    expect(fs.files.has('cards/c1/front.jpg.old')).toBe(false);
    // a crash between parking and the final move: the sweep moves the parked photo back
    fs.files.delete('cards/c1/front.jpg');
    fs.files.add('cards/c1/front.jpg.old');
    const plan = await runSweep(fs.ops, db);
    expect(plan.parked).toEqual(['cards/c1/front.jpg.old']);
    expect(fs.files.has('cards/c1/front.jpg')).toBe(true);
    expect(fs.files.has('cards/c1/front.jpg.old')).toBe(false);
  });

  it('delete keeps the files for the undo window; purge removes the row first, then the files', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg', thumb: 'tmp/t.jpg' }, 1);
    await deleteCards(db, ['c1'], 1000);
    expect(await purgeExpired(fs.ops, db, 1000 + UNDO_WINDOW_MS - 1)).toEqual([]);
    expect(fs.files.has('cards/c1/front.jpg')).toBe(true);
    expect(await purgeExpired(fs.ops, db, 1000 + UNDO_WINDOW_MS)).toEqual(['c1']);
    expect(await getCard(db, 'c1')).toBeNull();
    expect([...fs.files].filter((f) => f.startsWith('cards/'))).toEqual([]);
    expect(fs.dirs.has('cards/c1')).toBe(false);
  });

  it('the start-up sweep removes folders without a row (live or deleted rows keep theirs), stale staging files and the export cache', async () => {
    const fs = fakeFs();
    const db = await freshDb();
    await storeNewCard(fs.ops, db, card, { front: 'tmp/f.jpg' });
    await createCard(db, { ...card, id: 'c2' });
    await deleteCards(db, ['c2']);
    fs.dirs.add('cards/orphan');
    fs.files.add('cards/orphan/front.jpg');
    fs.files.add('cards/c1/back.jpg.new');
    fs.files.add('cache/exports/old.zip');
    expect(planSweep(['c1', 'orphan'], ['c1', 'c2'], ['cards/c1/back.jpg.new', 'cards/c1/front.jpg'])).toEqual({ orphanFolders: ['cards/orphan'], staleStaging: ['cards/c1/back.jpg.new'], parked: [] });
    expect(await runSweep(fs.ops, db)).toEqual({ orphanFolders: ['cards/orphan'], staleStaging: ['cards/c1/back.jpg.new'], parked: [], exports: ['cache/exports/old.zip'] });
    expect(fs.files.has('cards/c1/front.jpg')).toBe(true);
    expect(fs.files.has('cards/orphan/front.jpg')).toBe(false);
    expect(fs.files.has('cache/exports/old.zip')).toBe(false);
  });

  it('S13 (independent review): a crash at ANY step of replacePhoto never leaves a row that claims a missing photo, and never loses a photo the row already records', async () => {
    for (const withOld of [false, true]) {
      for (let crashAt = 0; crashAt < 12; crashAt++) {
        // content-tracking fake: path → which photo it holds; after `crashAt` steps the process is dead (nothing runs)
        const content = new Map<string, string>([['tmp/n.jpg', 'NEW']]);
        const dirs = new Set<string>();
        let steps = 0;
        const alive = () => steps++ < crashAt;
        const live: FileOps = {
          async move(from, to) {
            if (!content.has(from)) throw new Error(`missing ${from}`);
            content.set(to, content.get(from)!);
            content.delete(from);
          },
          async remove(path) {
            for (const k of [...content.keys()]) if (k === path || k.startsWith(`${path}/`)) content.delete(k);
            dirs.delete(path);
          },
          async exists(path) {
            return content.has(path) || dirs.has(path);
          },
          async makeDir(path) {
            dirs.add(path);
          },
          async list(dir) {
            const out = new Set<string>();
            for (const f of [...content.keys(), ...dirs]) if (f.startsWith(`${dir}/`)) out.add(f.slice(dir.length + 1).split('/')[0]);
            return [...out];
          },
        };
        const dying: FileOps = {
          move: async (a, b) => (alive() ? live.move(a, b) : new Promise(() => undefined)),
          remove: async (a) => (alive() ? live.remove(a) : new Promise(() => undefined)),
          exists: async (a) => (alive() ? live.exists(a) : new Promise(() => undefined)),
          makeDir: async (a) => (alive() ? live.makeDir(a) : new Promise(() => undefined)),
          list: async (a) => (alive() ? live.list(a) : new Promise(() => undefined)),
        };
        const db = await freshDb();
        await createCard(db, { ...card, hasFront: withOld }, 1);
        if (withOld) {
          dirs.add('cards/c1');
          content.set('cards/c1/front.jpg', 'OLD');
        }
        let committed = false;
        const run = replacePhoto(dying, 'c1', 'front', 'tmp/n.jpg', async () => {
          if (!alive()) return new Promise<void>(() => undefined); // died before the commit
          await updateCard(db, 'c1', { hasFront: true });
          committed = true;
        }).catch(() => undefined);
        await Promise.race([run, new Promise((r) => setTimeout(r, 5))]);
        await runSweep(live, db);
        const row = await getCard(db, 'c1');
        const front = content.get('cards/c1/front.jpg');
        expect({ withOld, crashAt, claimsMissing: row!.hasFront && front === undefined }).toEqual({ withOld, crashAt, claimsMissing: false });
        if (committed) expect({ withOld, crashAt, front }).toEqual({ withOld, crashAt, front: 'NEW' });
      }
    }
  });
});
