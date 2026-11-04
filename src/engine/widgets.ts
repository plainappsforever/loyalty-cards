// Widget snapshot (SPEC §5.8): up to 8 cards — the chosen ids first, then favourites, then most used; never archived or
// deleted cards. Pure; src/lib/widgets.ts (P7) pushes it to the App Group / Android files dir with the barcode PNGs.
import { initials } from './format';
import { mostUsed, type Sortable } from './sort';

export type SnapshotCard = { id: string; name: string; color: string; initials: string; pngPath?: string };
export type Snapshot = { cards: SnapshotCard[]; updatedAt: number };
export const SNAPSHOT_MAX = 8;

type Input = Sortable & { archived: boolean; color: string; format: string };

export function buildSnapshot<T extends Input>(cards: readonly T[], widgetCardIds: readonly string[], updatedAt: number, pngPath?: (card: T) => string | undefined): Snapshot {
  const live = cards.filter((c) => !c.archived);
  const byId = new Map(live.map((c) => [c.id, c]));
  const chosen: T[] = [];
  const seen = new Set<string>();
  const take = (c: T | undefined) => {
    if (!c || seen.has(c.id) || chosen.length >= SNAPSHOT_MAX) return;
    seen.add(c.id);
    chosen.push(c);
  };
  for (const id of widgetCardIds) take(byId.get(id));
  for (const c of live) if (c.favourite) take(c);
  for (const c of mostUsed(live, SNAPSHOT_MAX)) take(c);
  for (const c of live) take(c);
  return {
    cards: chosen.map((c) => {
      const path = c.format === 'none' ? undefined : pngPath?.(c);
      return { id: c.id, name: c.name, color: c.color, initials: initials(c.name), ...(path ? { pngPath: path } : {}) };
    }),
    updatedAt,
  };
}
