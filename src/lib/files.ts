// Card photo files (SPEC §4.1, Offscan D28 ordering; card-scanner pattern). The file system is injected (`FileOps`):
// the app passes an expo-file-system implementation (P5/P6), tests a fake with injected failures (A19). Paths stored
// or derived are RELATIVE to the documents folder (iOS changes the container path between installs).
//
// New card: photos written to a temp path by the capture code → moved into cards/<id>/ → ONE transaction inserts the
// row. A failed move removes what this call already moved and creates no row; a failed transaction removes the moved
// files too (and a crash in between leaves a folder the start-up sweep removes). Deletion runs the other way: the row
// goes first (purgeDeleted), files after. The app only ever removes its own files under cards/ and cache/exports/.
import { createCard, purgeDeleted, type NewCard, type Purged, allCardIds } from '@/db/cards';
import type { Db } from '@/db/types';

export type FileOps = {
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  makeDir(path: string): Promise<void>;
  /** Names of the entries directly inside `dir` (folders without a trailing slash); [] when it does not exist. */
  list(dir: string): Promise<string[]>;
};

export const CARDS_DIR = 'cards';
export const EXPORTS_DIR = 'cache/exports';
export const WIDGETS_DIR = 'widgets';
export type PhotoSide = 'front' | 'back';

export function cardDir(cardId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cardId)) throw new Error(`unsafe card id "${cardId}"`);
  return `${CARDS_DIR}/${cardId}`;
}

/** The fixed file names of a card's photos (SPEC §4.1). */
export function photoPaths(cardId: string): { front: string; back: string; thumb: string } {
  const dir = cardDir(cardId);
  return { front: `${dir}/front.jpg`, back: `${dir}/back.jpg`, thumb: `${dir}/thumb.jpg` };
}

/** Photos as captured: temp paths the FileOps implementation understands. */
export type CapturedPhotos = { front?: string; back?: string; thumb?: string };

async function moveIn(fs: FileOps, cardId: string, photos: CapturedPhotos): Promise<string[]> {
  const p = photoPaths(cardId);
  const moved: string[] = [];
  try {
    if (photos.front || photos.back || photos.thumb) await fs.makeDir(cardDir(cardId));
    for (const [side, dest] of [
      ['front', p.front],
      ['back', p.back],
      ['thumb', p.thumb],
    ] as const) {
      const temp = photos[side];
      if (!temp) continue;
      await fs.move(temp, dest);
      moved.push(dest);
    }
  } catch (error) {
    for (const path of moved) await fs.remove(path).catch(() => undefined);
    throw error;
  }
  return moved;
}

/** Moves the captured photos into the card folder, then inserts the row. Returns the card id. */
export async function storeNewCard(fs: FileOps, db: Db, card: NewCard & { id: string }, photos: CapturedPhotos = {}, now = Date.now()): Promise<string> {
  const moved = await moveIn(fs, card.id, photos);
  try {
    await createCard(db, { ...card, hasFront: !!photos.front, hasBack: !!photos.back }, now);
  } catch (error) {
    for (const path of moved) await fs.remove(path).catch(() => undefined);
    if (moved.length) await fs.remove(cardDir(card.id)).catch(() => undefined);
    throw error;
  }
  return card.id;
}

/**
 * "Add photo" / "Retake" on an existing card. Files first, row LAST (independent review S13): the new file is staged as
 * `.new`, the old photo parked as `.old`, the new one moved into place, and only then the caller's `update` (one
 * transaction) records it; `.old` is removed after the commit. A crash at any step leaves either the old state (the
 * sweep removes `.new` and moves `.old` back) or the new photo in place — never a row that claims a missing file, never
 * a recorded photo deleted. A failed move or update undoes the swap and rethrows.
 */
export async function replacePhoto(fs: FileOps, cardId: string, side: PhotoSide, temp: string, update: () => Promise<void>): Promise<void> {
  const dest = photoPaths(cardId)[side];
  const staging = `${dest}.new`;
  const parked = `${dest}.old`;
  await fs.makeDir(cardDir(cardId));
  await fs.move(temp, staging);
  const hadOld = await fs.exists(dest);
  try {
    if (hadOld) await fs.move(dest, parked);
    await fs.move(staging, dest);
  } catch (error) {
    if (hadOld && !(await fs.exists(dest).catch(() => true))) await fs.move(parked, dest).catch(() => undefined);
    await fs.remove(staging).catch(() => undefined);
    throw error;
  }
  try {
    await update();
  } catch (error) {
    // the row was not changed: put the old photo back (or take the unrecorded new one away)
    await fs.remove(dest).catch(() => undefined);
    if (hadOld) await fs.move(parked, dest).catch(() => undefined);
    throw error;
  }
  if (hadOld) await fs.remove(parked).catch(() => undefined);
}

/** Removes the files of purged cards (call AFTER purgeDeleted committed). Missing files are fine. */
export async function removeCardFiles(fs: FileOps, purged: readonly Purged[]): Promise<void> {
  for (const c of purged) {
    const p = photoPaths(c.id);
    for (const path of [p.front, p.back, p.thumb, `${p.front}.new`, `${p.back}.new`, `${p.front}.old`, `${p.back}.old`]) await fs.remove(path).catch(() => undefined);
    await fs.remove(cardDir(c.id)).catch(() => undefined);
  }
}

/** Purges cards whose undo window has passed, rows first, then their files. Returns the purged ids. */
export async function purgeExpired(fs: FileOps, db: Db, now = Date.now()): Promise<string[]> {
  const purged = await purgeDeleted(db, now);
  await removeCardFiles(fs, purged);
  return purged.map((p) => p.id);
}

export type SweepPlan = { orphanFolders: string[]; staleStaging: string[]; parked: string[] };

/**
 * Start-up sweep: card folders without ANY row (live or in the undo window) are removed; `.new` staging files whose
 * replace never finished are removed (the old photo stays); a parked `.old` photo whose final move never happened is
 * moved back when the final file is missing, else removed. Pure planning; `runSweep` executes it.
 * MUST run before any capture starts (review R7): a capture in flight looks exactly like an orphan folder.
 */
export function planSweep(folders: readonly string[], rowIds: readonly string[], stagingFiles: readonly string[] = []): SweepPlan {
  const ids = new Set(rowIds);
  return {
    orphanFolders: folders.filter((f) => !ids.has(f)).map((f) => `${CARDS_DIR}/${f}`),
    staleStaging: stagingFiles.filter((f) => f.endsWith('.new')),
    parked: stagingFiles.filter((f) => f.endsWith('.old')),
  };
}

/** Runs the start-up sweep and empties the export cache (SPEC §4.1). Returns what was removed. */
export async function runSweep(fs: FileOps, db: Db): Promise<SweepPlan & { exports: string[] }> {
  const folders = await fs.list(CARDS_DIR);
  const ids = await allCardIds(db);
  const staging: string[] = [];
  for (const id of ids) for (const f of await fs.list(cardDir(id))) if (f.endsWith('.new') || f.endsWith('.old')) staging.push(`${cardDir(id)}/${f}`);
  const plan = planSweep(folders, ids, staging);
  for (const path of [...plan.orphanFolders, ...plan.staleStaging]) await fs.remove(path).catch(() => undefined);
  for (const parked of plan.parked) {
    const final = parked.slice(0, -4);
    if (await fs.exists(final)) await fs.remove(parked).catch(() => undefined);
    else await fs.move(parked, final).catch(() => undefined);
  }
  const exports = (await fs.list(EXPORTS_DIR)).map((f) => `${EXPORTS_DIR}/${f}`);
  for (const path of exports) await fs.remove(path).catch(() => undefined);
  return { ...plan, exports };
}
