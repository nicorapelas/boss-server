import type { SignOptions } from 'jsonwebtoken'

/** Long-lived API bearer — Back Office / POS stay signed in across shifts. */
export const ACCESS_TOKEN_EXPIRES_IN: SignOptions['expiresIn'] = '365d'

/** Refresh JWT lifetime (must cover DB session below). */
export const REFRESH_TOKEN_EXPIRES_IN: SignOptions['expiresIn'] = '3650d'

/** Stored on user document; informational / legacy — refresh no longer enforces this. */
export const REFRESH_TOKEN_DB_MS = 3650 * 24 * 60 * 60 * 1000
