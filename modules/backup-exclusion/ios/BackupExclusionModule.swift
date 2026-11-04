import ExpoModulesCore

// Template D12 (cycle-tracker review M4, step-counter D57): keeps a folder — the app passes expo-sqlite's
// `defaultDatabaseDirectory`, i.e. Documents/SQLite — out of iCloud and Finder backups. The flag is set on the DIRECTORY:
// Apple skips a directory's contents with it, and SQLite deletes and recreates its -wal/-shm files, which would lose a
// per-file flag. Glue: src/lib/backup-exclusion.ts (called at every launch). AsyncFunction runs off the main thread.
public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    AsyncFunction("excludeDirectory") { (path: String) -> [String: Any] in
      var url = URL(fileURLWithPath: path, isDirectory: true)
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: nil)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return ["path": url.path, "excluded": Self.isExcluded(path)]
    }

    AsyncFunction("isExcluded") { (path: String) -> Bool in
      return Self.isExcluded(path)
    }
  }

  // A fresh URL each time: URL caches resource values, so re-reading through the URL that set the flag proves nothing.
  private static func isExcluded(_ path: String) -> Bool {
    let fresh = URL(fileURLWithPath: path)
    let values = try? fresh.resourceValues(forKeys: [.isExcludedFromBackupKey])
    return values?.isExcludedFromBackup ?? false
  }
}
