// Rating prompt (1.1.0 redesign). Asked once per app version, after real use: the fifth time any card was shown at the
// till (use_count summed over the cards, see recordUse). Never on first launch (five uses cannot happen there) and never
// while a barcode is on screen: only the Settings and the Add screens call it, neither of which shows a code.
// The flag lives in the settings table, which no backup or export carries (export.ts writes cards only).
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';

import type { Db } from '@/db/types';
import { getSetting, setSetting } from '@/db/settings';
import { withRead } from '@/db/tx';

export const REVIEW_AFTER_USES = 5;
export const REVIEW_KEY = 'review_asked_version';

/** Pure decision: enough till uses and not yet asked in this app version. */
export function shouldAskForReview(totalUses: number, askedVersion: string | null, version: string): boolean {
  if (version === '') return false;
  return totalUses >= REVIEW_AFTER_USES && askedVersion !== version;
}

export type ReviewDeps = {
  version: string;
  isAvailable: () => Promise<boolean>;
  request: () => Promise<void>;
};

const realDeps = (): ReviewDeps => ({
  version: Constants.expoConfig?.version ?? '',
  isAvailable: () => StoreReview.isAvailableAsync(),
  request: () => StoreReview.requestReview(),
});

async function totalUses(db: Db): Promise<number> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number | null }>('SELECT SUM(use_count) AS n FROM cards WHERE deleted_at IS NULL'));
  return row?.n ?? 0;
}

/** Asks for a rating when the rules allow it; true when the system sheet was requested. Never throws. */
export async function maybeAskForReview(db: Db, deps: ReviewDeps = realDeps()): Promise<boolean> {
  try {
    const asked = await getSetting(db, REVIEW_KEY);
    if (!shouldAskForReview(await totalUses(db), asked, deps.version)) return false;
    if (!(await deps.isAvailable())) return false;
    // the flag first: a crash inside the system sheet must not make it come back on every start
    await setSetting(db, REVIEW_KEY, deps.version);
    await deps.request();
    return true;
  } catch {
    return false;
  }
}
