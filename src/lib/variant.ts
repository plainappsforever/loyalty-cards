// Which build variant the JavaScript side runs in, read from the Expo config embedded in the binary (app.config.ts `extra.appVariant`).
// F1 / D54: the test routes and dev read-outs are open ONLY when the variant is explicitly `preview` or `development`. Anything else
// (production, missing, misspelled, config not readable) is closed: a release archive built without APP_VARIANT must not open them.
import Constants from 'expo-constants';

export function isTestVariant(variant: unknown): boolean {
  return variant === 'preview' || variant === 'development';
}

export function currentVariant(): unknown {
  return Constants.expoConfig?.extra?.appVariant;
}

/** True in development and preview builds only (fails closed). */
export function testToolsEnabled(): boolean {
  return isTestVariant(currentVariant());
}

/** F5 / D54: `debug/seed` hard-deletes every card. Preview builds (which testers may use with real cards) ask for this word first. */
export const WIPE_WORD = 'WIPE';

export function seedNeedsConfirmation(variant: unknown, hasData: boolean): boolean {
  return variant === 'preview' && hasData;
}

export function wipeConfirmed(typed: string): boolean {
  return typed.trim() === WIPE_WORD;
}

/**
 * Store-screenshot switch (preview and development only): the seed set `store-demo` stores `store_shots=1` in the settings table, and
 * while it is set every debug read-out (card open time, backup line, variant tag in the version line) stays hidden so a store
 * screenshot shows what a customer sees. Any other seed set removes it. Production never has the read-outs, so it is unaffected.
 */
export const STORE_SHOTS_KEY = 'store_shots';

export function debugReadoutsVisible(variant: unknown, storeShots: string | null): boolean {
  return isTestVariant(variant) && storeShots !== '1';
}
