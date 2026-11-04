// The product name and identifier in ONE place for the JS side (D11). app.config.ts carries the same two constants for
// the native side (it cannot import from src/ reliably at config time); src/constants/app.test.ts keeps them in sync.
// Provisional until the owner picks the store name (D11 options; the orchestrator default is "Tillcard"). Never a
// personal name in any identifier or string.
export const APP_NAME = 'Tillcard';
export const APP_ID = 'loyaltycards';
export const ID_PREFIX = 'com.plainapps';
/** Store listing name (D11 default, orchestrator 2026-10-16; the owner may change it before P5). */
export const STORE_NAME = 'Tillcard: Loyalty Card Wallet';
