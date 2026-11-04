// D12 (cycle-tracker review M4, step-counter D57): on iOS the SQLite FOLDER is marked isExcludedFromBackup at every
// launch (a flag on the files would be lost when SQLite deletes and recreates -wal/-shm). The native side is
// modules/backup-exclusion; this tests the glue with a fake module. It never throws: a failed exclusion is reported,
// it never blocks the app from opening.
import { excludeFromBackup, nativeBackupExclusion, toFilePath, type BackupExclusionNative } from './backup-exclusion';

function fakeNative(opts: { fail?: boolean; excluded?: boolean } = {}) {
  const calls: string[] = [];
  const native: BackupExclusionNative = {
    async excludeDirectory(path) {
      calls.push(path);
      if (opts.fail) throw new Error('NSCocoaErrorDomain 513');
      return { path, excluded: opts.excluded ?? true };
    },
    async isExcluded() {
      return opts.excluded ?? true;
    },
  };
  return { native, calls };
}

it('no native module in Jest (and on Android, which uses the backup rule files) → null', () => {
  expect(nativeBackupExclusion).toBeNull();
});

it('file:// URIs and percent escapes become plain paths; plain paths stay', () => {
  expect(toFilePath('file:///var/mobile/Containers/Data/Application/AB%20C/Documents/SQLite')).toBe('/var/mobile/Containers/Data/Application/AB C/Documents/SQLite');
  expect(toFilePath('/data/user/0/x/files/SQLite')).toBe('/data/user/0/x/files/SQLite');
  expect(toFilePath('')).toBeNull();
  expect(toFilePath(null)).toBeNull();
});

it('marks the folder through the native module and reports the flag it read back', async () => {
  const { native, calls } = fakeNative();
  await expect(excludeFromBackup('file:///Documents/SQLite', native)).resolves.toEqual({ status: 'excluded', path: '/Documents/SQLite' });
  expect(calls).toEqual(['/Documents/SQLite']);
});

it('never throws: no module → not-applicable, native error or flag not set → failed with the reason', async () => {
  await expect(excludeFromBackup('/Documents/SQLite', null)).resolves.toEqual({ status: 'not-applicable', path: '/Documents/SQLite' });
  await expect(excludeFromBackup(null, fakeNative().native)).resolves.toEqual({ status: 'failed', path: null, reason: 'no database folder' });
  await expect(excludeFromBackup('/D/SQLite', fakeNative({ fail: true }).native)).resolves.toEqual({ status: 'failed', path: '/D/SQLite', reason: 'NSCocoaErrorDomain 513' });
  await expect(excludeFromBackup('/D/SQLite', fakeNative({ excluded: false }).native)).resolves.toEqual({ status: 'failed', path: '/D/SQLite', reason: 'flag not set' });
});
