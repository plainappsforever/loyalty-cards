// Device wiring of the pure services: expo-file-system FileOps, code-kit image conversion, sharing, start-up tasks and
// the card-open clock. Screens call these; the logic they wrap is tested in Node (files, import, export, code-cache).
import { Directory, File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';

import { cardsNeedingCodeCache, putCodeCache } from '@/db/code-cache';
import { codeOf, getCard } from '@/db/cards';
import type { Db } from '@/db/types';

import { transcodeImage } from '../../modules/code-kit';
import { buildCodeCache } from './code-cache';
import { EXPORTS_DIR, photoPaths, purgeExpired, runSweep, type PhotoSide } from './files';
import { docUri, expoFs, readBytes, tempPath, writeBytes } from './fs-expo';
import type { ExportDeps } from './export';
import type { ImportDeps } from './import';
import { excludeFromBackup, nativeBackupExclusion, type BackupExclusionResult } from './backup-exclusion';
import { CARDS_DIR } from './files';
import { requestWidgetSync, widgetImageDirUri } from './widgets';

/** SPEC §4.1: card photos are EXIF-free JPEGs, long edge ≤ 1600 px, quality 0.85. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.85;

/** A picked/taken image → a temp EXIF-free JPEG (documents-relative path) ready for storeNewCard/replacePhoto. */
export async function photoToTempJpeg(uri: string): Promise<string> {
  const out = tempPath('jpg');
  await transcodeImage(uri, docUri(out), 'jpeg', PHOTO_MAX_EDGE, PHOTO_QUALITY);
  return out;
}

export const importDeps: ImportDeps = {
  fs: expoFs,
  async toJpeg(bytes, source) {
    const raw = tempPath(source === 'png' ? 'png' : 'jpg');
    writeBytes(raw, bytes);
    try {
      return await photoToTempJpeg(docUri(raw));
    } finally {
      await expoFs.remove(raw).catch(() => undefined);
    }
  },
};

export const exportDeps: ExportDeps = {
  async readPhoto(cardId, side) {
    const path = photoPaths(cardId)[side];
    return (await expoFs.exists(path)) ? readBytes(path) : null;
  },
  async photoAsPng(cardId, side: PhotoSide) {
    const path = photoPaths(cardId)[side];
    if (!(await expoFs.exists(path))) return null;
    const out = tempPath('png');
    try {
      await transcodeImage(docUri(path), docUri(out), 'png', 0, 1);
      return await readBytes(out);
    } finally {
      await expoFs.remove(out).catch(() => undefined);
    }
  },
};

/** Writes an export into cache/exports (emptied on the next start, SPEC §4.1) and returns its file:// URI. */
export function writeExportFile(fileName: string, bytes: Uint8Array): string {
  return writeBytes(`${EXPORTS_DIR}/${fileName}`, bytes);
}

export async function shareFile(uri: string, mimeType: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: uri.split('/').pop() });
  return true;
}

/** Photo URI for <Image>, with a version so a replaced photo is not served from the image cache. */
export function photoUri(cardId: string, side: PhotoSide, version: number): string {
  return `${new File(Paths.document, photoPaths(cardId)[side]).uri}?v=${version}`;
}

/** Last results of the iOS backup exclusion (D12/D49), for the dev-only line in Settings. */
export let backupExclusion: BackupExclusionResult[] = [];

/**
 * D12 / D49: iOS backups (iCloud, Finder) skip the database folder, the card photos and the widget PNGs; re-applied at
 * every launch, never blocking, never throwing. Android: plugins/with-backup-rules.js (the module is iOS-only → 'not-applicable').
 */
export async function excludeAppDataFromBackup(): Promise<BackupExclusionResult[]> {
  const dirs = [defaultDatabaseDirectory, new Directory(Paths.document, CARDS_DIR).uri, widgetImageDirUri()];
  backupExclusion = await Promise.all(dirs.filter((d): d is string => !!d).map((d) => excludeFromBackup(d, nativeBackupExclusion)));
  return backupExclusion;
}

/** Reads the flag back from a fresh URL (dev-only diagnostics); null where the module does not exist (Android, Jest). */
export async function isExcludedFromBackup(path: string): Promise<boolean | null> {
  return nativeBackupExclusion ? nativeBackupExclusion.isExcluded(path) : null;
}

let startup: Promise<void> | null = null;

/**
 * Once per JS context, before any capture (review R7: a capture in flight looks like an orphan folder): the file sweep,
 * the purge of cards past the undo window, the temp folder. Then, without blocking, the render-once cache for any 2D card
 * that has none (cards from before migration 3, seeds) — one card per tick so the UI stays responsive.
 */
export function runStartupTasks(db: Db): Promise<void> {
  startup ??= (async () => {
    await runSweep(expoFs, db).catch((e) => console.warn('sweep failed', e));
    await purgeExpired(expoFs, db).catch((e) => console.warn('purge failed', e));
    for (const name of await expoFs.list('tmp')) await expoFs.remove(`tmp/${name}`).catch(() => undefined);
    // a 2D card that just got its render shows its code in the widgets too (widgets.ts reads the cache, never encodes)
    setTimeout(() => void fillCodeCache(db).then((n) => n > 0 && requestWidgetSync()), 1500);
  })();
  return startup;
}

export async function fillCodeCache(db: Db): Promise<number> {
  let n = 0;
  for (const { id } of await cardsNeedingCodeCache(db)) {
    await new Promise((r) => setTimeout(r, 0));
    const card = await getCard(db, id);
    if (!card) continue;
    const entry = buildCodeCache(codeOf(card), card.format);
    if (entry) {
      await putCodeCache(db, id, entry);
      n++;
    }
  }
  return n;
}

// Card-open clock (A9, D42): the tile tap stores performance.now(); the card screen reads it once when the code is drawn.
let tap: { id: string; at: number } | null = null;
export function markTap(id: string): void {
  tap = { id, at: performance.now() };
}
/** Milliseconds since the tap on this card, without consuming it (stage marks); null when none. */
export function tapAge(id: string): number | null {
  return tap && tap.id === id ? performance.now() - tap.at : null;
}
export function takeTap(id: string): number | null {
  if (!tap || tap.id !== id) return null;
  const ms = performance.now() - tap.at;
  tap = null;
  return ms;
}
