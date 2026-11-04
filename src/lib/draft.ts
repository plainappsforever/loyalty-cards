// Add/Edit form draft (SPEC §9 "Process death with the Edit form open", review F3 / D55). The form saves what the user typed
// into the `draft_card` setting while the app goes to the background or after a pause in typing, and restores it the next time
// the same form (a new card, or the same card's Edit) opens. A deliberate leave (Back, Save) clears it: the draft is a safety net
// for losing the form against the user's will (Android kills the process, a widget or shortcut tap starts a fresh task, D53.4).
// Photos are not part of the draft (their temp files are swept at start-up); neither is the "number checked against the card"
// switch, which has to be flipped again by the user (D41.2).
import { isFormatId, type FormatId } from '@/engine/barcode/formats';

export type DraftFields = {
  name: string;
  number: string;
  differs: boolean;
  codeValue: string;
  /** null = "let the app pick from the suggestions". */
  format: FormatId | null;
  color: string | null;
  chainId: string | null;
  categoryIds: string[];
  note: string;
  balance: string;
  currency: string;
  expiry: string;
  validFrom: string;
};

export type EditDraft = {
  v: 1;
  /** 'new' for the Add form, else the id of the card being edited. */
  target: string;
  /** `updatedAt` of the card when the form was opened (null for 'new'); a card changed since drops the draft. */
  baseUpdatedAt: number | null;
  savedAt: number;
  fields: DraftFields;
};

export const EMPTY_FIELDS: DraftFields = {
  name: '',
  number: '',
  differs: false,
  codeValue: '',
  format: null,
  color: null,
  chainId: null,
  categoryIds: [],
  note: '',
  balance: '',
  currency: '',
  expiry: '',
  validFrom: '',
};

const STRING_KEYS = ['name', 'number', 'codeValue', 'note', 'balance', 'currency', 'expiry', 'validFrom'] as const;

export function serialiseDraft(draft: EditDraft): string {
  return JSON.stringify(draft);
}

const nullableString = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' ? v : undefined);

/** Reads a stored draft; anything unreadable or of another shape → null (never throws). */
export function parseDraft(raw: string | null): EditDraft | null {
  if (!raw) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    const f = o.fields as Record<string, unknown> | null | undefined;
    if (o.v !== 1 || typeof o.target !== 'string' || o.target === '' || typeof o.savedAt !== 'number' || typeof f !== 'object' || f === null) return null;
    if (!(o.baseUpdatedAt === null || typeof o.baseUpdatedAt === 'number')) return null;
    const fields: DraftFields = { ...EMPTY_FIELDS };
    for (const k of STRING_KEYS) {
      if (typeof f[k] !== 'string') return null;
      fields[k] = f[k];
    }
    if (typeof f.differs !== 'boolean') return null;
    fields.differs = f.differs;
    const format = nullableString(f.format);
    if (format === undefined || (format !== null && !isFormatId(format))) return null;
    fields.format = format as FormatId | null;
    const color = nullableString(f.color);
    const chainId = nullableString(f.chainId);
    if (color === undefined || chainId === undefined) return null;
    fields.color = color;
    fields.chainId = chainId;
    if (!Array.isArray(f.categoryIds) || !f.categoryIds.every((x) => typeof x === 'string')) return null;
    fields.categoryIds = f.categoryIds as string[];
    return { v: 1, target: o.target, baseUpdatedAt: o.baseUpdatedAt as number | null, savedAt: o.savedAt, fields };
  } catch {
    return null;
  }
}

/** The draft belongs to this form: same target, and (Edit) the card has not been changed since the form was opened. */
export function draftApplies(draft: EditDraft | null, target: string, baseUpdatedAt: number | null): draft is EditDraft {
  return draft !== null && draft.target === target && draft.baseUpdatedAt === baseUpdatedAt;
}

/** Stable text of the fields, to tell "user changed something" from "nothing typed". */
export function fieldsKey(fields: DraftFields): string {
  return JSON.stringify(fields);
}
