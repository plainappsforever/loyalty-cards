// expo-file-system implementation of FileOps (src/lib/files.ts). Paths are RELATIVE to the documents folder (iOS
// changes the container path between installs); temp files the capture code creates live under `tmp/` there, so a move
// into `cards/<id>/` stays on one volume. Absolute file:// URIs are accepted as move sources (picker/camera results).
import { Directory, File, Paths } from 'expo-file-system';

import type { FileOps } from './files';

export const TMP_DIR = 'tmp';

/** file:// URI of a documents-relative path (or the URI itself when it already is one). */
export function docUri(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) return path;
  return new File(Paths.document, path).uri;
}

export const expoFs: FileOps = {
  async move(from, to) {
    const src = new File(docUri(from));
    const dest = new File(docUri(to));
    if (dest.exists) dest.delete(); // `to` is always a path this app owns (cards/<id>/…)
    await src.move(dest);
  },
  async remove(path) {
    const f = new File(docUri(path));
    if (f.exists) {
      f.delete();
      return;
    }
    const d = new Directory(docUri(path));
    if (d.exists) d.delete();
  },
  async exists(path) {
    return new File(docUri(path)).exists || new Directory(docUri(path)).exists;
  },
  async makeDir(path) {
    const d = new Directory(docUri(path));
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  },
  async list(dir) {
    const d = new Directory(docUri(dir));
    if (!d.exists) return [];
    return d.list().map((e) => e.name);
  },
};

/** A fresh temp path (documents-relative) for a capture; the folder is created. */
export function tempPath(ext: string): string {
  const dir = new Directory(Paths.document, TMP_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return `${TMP_DIR}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

export async function readBytes(uri: string): Promise<Uint8Array> {
  return new File(docUri(uri)).bytes();
}

export function writeBytes(path: string, bytes: Uint8Array): string {
  const f = new File(docUri(path));
  const parent = f.parentDirectory;
  if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  return f.uri;
}

export function fileSize(path: string): number {
  return new File(docUri(path)).size ?? 0;
}

/** Name of the last path segment of a URI, decoded ("Catima%20Export.zip" → "Catima Export.zip"). */
export function uriName(uri: string): string {
  const last = uri.split('?')[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
