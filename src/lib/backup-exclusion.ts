// iOS: keep the SQLite database out of iCloud / Finder backups (D12; cycle-tracker review M4, step-counter D57).
// expo-sqlite keeps every database in `Documents/SQLite` on iOS (SQLiteModule.swift `defaultDatabaseDirectory`), a folder
// iOS backs up by default. The local module `modules/backup-exclusion` (iOS only, autolinked from `modules/`) sets
// `URLResourceValues.isExcludedFromBackup` on the FOLDER: Apple excludes a directory's contents with it, and SQLite
// deletes and recreates its -wal/-shm files, which would lose a per-file flag. Re-applied at every launch
// (src/app/_layout.tsx), never blocking and never throwing: a failure is returned for a diagnostics screen.
// Android has no such flag; there the rule files of plugins/with-backup-rules.js do the job, so the module is not linked
// and the lookup returns null ('not-applicable').
// IMPLEMENTED BUT UNVERIFIED on a device: the Swift's Foundation statements were type-checked for the iOS simulator SDK
// and run on macOS (flag set, read back through a fresh URL; 2026-10-26); the Expo DSL around them follows card-scanner's
// built CardKitModule (AsyncFunction returning [String: Any]). An app's first iOS build compiles it; its device phase
// reads the flag back (`isExcluded`) after a WAL checkpoint and a relaunch.
import { requireOptionalNativeModule } from 'expo';

export type BackupExclusionNative = {
  /** Creates the folder if missing, sets isExcludedFromBackup on it, reads the flag back from a fresh URL. */
  excludeDirectory(path: string): Promise<{ path: string; excluded: boolean }>;
  isExcluded(path: string): Promise<boolean>;
};

export type BackupExclusionResult =
  | { status: 'excluded' | 'not-applicable'; path: string }
  | { status: 'failed'; path: string | null; reason: string };

/** The native module, or null (Jest, web, Android, a build made before the module existed). */
export const nativeBackupExclusion: BackupExclusionNative | null =
  requireOptionalNativeModule<BackupExclusionNative & Record<string, unknown>>('BackupExclusion');

/** `file:///…/SQLite` (or a plain path) → a plain file-system path; null for nothing. */
export function toFilePath(uriOrPath: string | null | undefined): string | null {
  if (!uriOrPath) return null;
  if (!uriOrPath.startsWith('file://')) return uriOrPath;
  try {
    return decodeURIComponent(uriOrPath.slice('file://'.length));
  } catch {
    return uriOrPath.slice('file://'.length);
  }
}

/** Marks `dir` as excluded from iOS backups. Never throws. */
export async function excludeFromBackup(dir: string | null | undefined, native: BackupExclusionNative | null): Promise<BackupExclusionResult> {
  const path = toFilePath(dir);
  if (!path) return { status: 'failed', path: null, reason: 'no database folder' };
  if (!native) return { status: 'not-applicable', path };
  try {
    const result = await native.excludeDirectory(path);
    return result.excluded ? { status: 'excluded', path } : { status: 'failed', path, reason: 'flag not set' };
  } catch (error) {
    return { status: 'failed', path, reason: error instanceof Error ? error.message : String(error) };
  }
}
