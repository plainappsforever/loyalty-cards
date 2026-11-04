// What came in (SPEC §7.8 Receive, U5/U6): a file opened with the app or picked in Import (Catima zip/CSV, our backup
// zip/json, generic CSV) or a scanned/pasted text (`LC1:` payload, Catima share link). Pure: bytes/text in, cards out,
// the engine readers do the work; nothing here repairs a value (L26). The Receive screen previews the result, the user
// picks the duplicate rule once, then src/lib/import.ts stores it.
import { BackupFormatError, readBackup } from '@/engine/backup/reader';
import type { ImportedCard, Skipped } from '@/engine/card-data';
import { CatimaFormatError, readCatima } from '@/engine/catima/reader';
import { parseCatimaShareUrl } from '@/engine/catima/share-url';
import { colorForName } from '@/engine/catima/color';
import { CsvFormatError, parseGenericCsv } from '@/engine/csv';
import { parseSharePayload } from '@/engine/share-payload';
import { isZip, readZip, utf8 } from '@/engine/zip';

export type ReceiveKind = 'catima' | 'backup' | 'csv' | 'payload' | 'catimaLink';
export type ImageKind = 'png' | 'jpeg';

/** Extra columns only our own backup carries. */
export type BackupExtras = { tile: 'initials' | 'photo'; chainId: string | null; useCount: number };

export type Received = {
  kind: ReceiveKind;
  cards: (ImportedCard & { extras?: BackupExtras })[];
  skipped: Skipped[];
  /** Categories in file order (Catima groups, backup categories). */
  categories: string[];
  /** Encoding of the image bytes on the cards: Catima = PNG, our backup = JPEG. */
  images: ImageKind;
  invalidCodes: number;
  truncatedNames: number;
  brokenPhotos: number;
};

export type ReceiveErrorCode = 'encrypted' | 'notSupported' | 'noCards' | 'version';

export class ReceiveError extends Error {
  readonly code: ReceiveErrorCode;
  constructor(code: ReceiveErrorCode) {
    super(code);
    this.code = code;
  }
}

const empty = (kind: ReceiveKind, images: ImageKind = 'png'): Received => ({ kind, cards: [], skipped: [], categories: [], images, invalidCodes: 0, truncatedNames: 0, brokenPhotos: 0 });

function fromBackup(bytes: Uint8Array): Received {
  try {
    const b = readBackup(bytes);
    return {
      ...empty('backup', 'jpeg'),
      cards: b.cards.map((c) => ({ ...c, extras: { tile: c.tile, chainId: c.chainId, useCount: c.useCount } })),
      skipped: b.skipped,
      categories: b.categories,
      invalidCodes: b.invalidCodes,
      brokenPhotos: b.brokenPhotos.length,
    };
  } catch (e) {
    if (e instanceof BackupFormatError) throw new ReceiveError(e.code === 'encrypted' ? 'encrypted' : e.code === 'version' ? 'version' : 'notSupported');
    throw e;
  }
}

function fromCatima(bytes: Uint8Array): Received {
  try {
    const c = readCatima(bytes);
    return { ...empty('catima'), cards: c.cards, skipped: c.skipped, categories: c.groups, invalidCodes: c.invalidCodes, truncatedNames: c.truncatedNames };
  } catch (e) {
    if (e instanceof CatimaFormatError) throw new ReceiveError(e.code === 'encrypted' ? 'encrypted' : 'notSupported');
    throw e;
  }
}

/** Reads a file's bytes. Throws ReceiveError when it is none of the formats we read. */
export function readIncomingFile(bytes: Uint8Array): Received {
  if (bytes.length === 0) throw new ReceiveError('notSupported');
  if (isZip(bytes)) {
    let names: string[];
    try {
      names = Object.keys(readZip(bytes));
    } catch (e) {
      if (e instanceof Error && /password|encrypt/i.test(e.message)) throw new ReceiveError('encrypted');
      throw new ReceiveError('notSupported');
    }
    if (names.some((n) => n === 'backup.json' || n.endsWith('/backup.json'))) return fromBackup(bytes);
    if (names.some((n) => n.toLowerCase() === 'catima.csv')) return fromCatima(bytes);
    throw new ReceiveError('notSupported');
  }
  const text = utf8.decode(bytes).replace(/^﻿/, '');
  const trimmed = text.trim();
  const fromText = readIncomingText(trimmed);
  if (fromText) return fromText;
  if (trimmed.startsWith('{')) return fromBackup(bytes);
  try {
    return fromCatima(bytes);
  } catch (e) {
    if (!(e instanceof ReceiveError) || e.code !== 'notSupported') throw e;
  }
  try {
    const g = parseGenericCsv(text);
    return { ...empty('csv'), cards: g.cards, skipped: g.skipped, invalidCodes: g.invalidCodes };
  } catch (e) {
    if (e instanceof CsvFormatError) throw new ReceiveError('notSupported');
    throw e;
  }
}

/**
 * An `LC1:` payload or a Catima share link (scanned QR, pasted text); null when the text is neither. Both parsers already
 * apply checkImportedCode and the "Catima type: X" note (D33 Q4), so a card arrives here as it will be stored.
 */
export function readIncomingText(text: string): Received | null {
  const t = text.trim();
  const payload = parseSharePayload(t);
  if (payload) return { ...empty('payload'), cards: [{ ...payload, images: {} }] };
  const link = parseCatimaShareUrl(t);
  if (link) {
    const { unknownType: _unknown, ...rest } = link;
    const card = { ...rest, color: link.color ?? colorForName(link.name), favourite: false, archived: false, lastUsedAt: null, categories: [] as string[], images: {} };
    return { ...empty('catimaLink'), cards: [card] };
  }
  return null;
}
