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
