// Settings (SPEC §4.2 keys) as typed values with defaults; stored as text in the `settings` table.
import { parseDraft, serialiseDraft, type EditDraft } from '@/lib/draft';
import type { LanguagePreference } from '@/i18n';

import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type SortMode = 'manual' | 'name' | 'most_used' | 'recent';

const THEME_KEY = 'theme';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const SORT_MODES: readonly SortMode[] = ['manual', 'name', 'most_used', 'recent'];

export type AppSettings = {
  brightnessBoost: boolean;
  keepAwake: boolean;
  /** Default manual, favourites first in the list (orchestrator default for Q5, D25). */
  sort: SortMode;
  language: LanguagePreference;
  showArchived: boolean;
  /** ISO 3166 alpha-2 for the chain list; '' = device region. */
  defaultCountry: string;
  widgetCardIds: string[];
  lastExportAt: number | null;
  /** Unsaved Edit form as JSON (SPEC §9 process death); null = none. */
  draftCard: string | null;
  theme: ThemePreference;
};

export const DEFAULT_SETTINGS: AppSettings = {
  brightnessBoost: true,
  keepAwake: true,
  sort: 'manual',
  language: 'system',
  showArchived: false,
  defaultCountry: '',
  widgetCardIds: [],
  lastExportAt: null,
  draftCard: null,
  theme: 'system',
};

const KEYS: Record<keyof AppSettings, string> = {
  brightnessBoost: 'brightness_boost',
  keepAwake: 'keep_awake',
  sort: 'sort',
  language: 'language',
  showArchived: 'show_archived',
  defaultCountry: 'default_country',
  widgetCardIds: 'widget_card_ids',
  lastExportAt: 'last_export_at',
  draftCard: 'draft_card',
  theme: THEME_KEY,
};

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key));
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await withWrite(db, (tx) => tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value));
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await withWrite(db, (tx) => tx.runAsync('DELETE FROM settings WHERE key = ?', key));
}

/** Parses one stored text into the typed value; anything unreadable → the default (never throws). */
export function parseSetting<K extends keyof AppSettings>(key: K, raw: string | null): AppSettings[K] {
  const d = DEFAULT_SETTINGS[key];
  if (raw === null) return d;
  switch (key) {
    case 'brightnessBoost':
    case 'keepAwake':
    case 'showArchived':
      return (raw === '1' ? true : raw === '0' ? false : d) as AppSettings[K];
    case 'sort':
      return (SORT_MODES.includes(raw as SortMode) ? raw : d) as AppSettings[K];
    case 'theme':
      return (THEMES.includes(raw as ThemePreference) ? raw : d) as AppSettings[K];
    case 'language':
      return (/^(system|[a-z]{2}(-[A-Z]{2})?)$/.test(raw) ? raw : d) as AppSettings[K];
    case 'defaultCountry':
      return (/^[A-Z]{2}$/.test(raw) ? raw : '') as AppSettings[K];
    case 'draftCard':
      return raw as AppSettings[K];
    case 'lastExportAt': {
      const n = Number(raw);
      return (Number.isInteger(n) && n > 0 ? n : null) as AppSettings[K];
    }
    case 'widgetCardIds': {
      try {
        const v: unknown = JSON.parse(raw);
        return (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : []) as AppSettings[K];
      } catch {
        return [] as unknown as AppSettings[K];
      }
    }
  }
}

export function serialiseSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === null) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** Every setting with defaults, in one read. */
export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(KEYS) as (keyof AppSettings)[]) {
    (out as Record<string, unknown>)[key] = parseSetting(key, map.get(KEYS[key]) ?? null);
  }
  return out;
}

export async function updateSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]): Promise<void> {
  if (value === null) await deleteSetting(db, KEYS[key]);
  else await setSetting(db, KEYS[key], serialiseSetting(key, value));
}

export async function getThemePreference(db: Db): Promise<ThemePreference> {
  return parseSetting('theme', await getSetting(db, THEME_KEY));
}

export function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, THEME_KEY, theme);
}

/** Add/Edit form draft (SPEC §9, D55): one slot; unreadable content reads as no draft. */
export async function loadDraftCard(db: Db): Promise<EditDraft | null> {
  return parseDraft(await getSetting(db, KEYS.draftCard));
}

export function saveDraftCard(db: Db, draft: EditDraft): Promise<void> {
  return setSetting(db, KEYS.draftCard, serialiseDraft(draft));
}

export function clearDraftCard(db: Db): Promise<void> {
  return deleteSetting(db, KEYS.draftCard);
}
