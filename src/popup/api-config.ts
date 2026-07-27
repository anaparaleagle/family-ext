// API host configuration for the popup. Kept in its own SIDE-EFFECT-FREE module
// so the migration logic can be unit-tested without dragging in popup.ts's
// module-load side effects (firebase.initializeApp, document.getElementById,
// init()).

/** Local dev backend — the default when nothing is persisted. */
export const DEFAULT_API_URL = "http://localhost:8001/api/v1";

/** Live production family backend. */
export const PROD_API_URL = "https://family-api.paraleagle.io/api/v1";

/**
 * The retired production host. Its DNS no longer resolves, so any persisted
 * copy must be migrated to PROD_API_URL before it is used or allowlisted.
 */
export const LEGACY_PROD_API_URL = "https://api.family.paraleagle.ai/api/v1";

/**
 * Origins requests are allowed to hit. The retired host is deliberately absent:
 * getApiUrl migrates a stale stored value to PROD_API_URL before this check, so
 * dropping the dead origin strands no one.
 */
export const ALLOWED_API_ORIGINS = [
  "https://family-api.paraleagle.io",
  "http://localhost:8001",
];

/**
 * Resolve the API base URL to use, healing a stale persisted value.
 *
 * - falsy (undefined / "") -> DEFAULT_API_URL
 * - the retired prod host   -> PROD_API_URL
 * - anything else           -> unchanged
 */
export function migrateApiBaseUrl(stored: string | undefined): string {
  if (!stored) return DEFAULT_API_URL;
  if (stored === LEGACY_PROD_API_URL) return PROD_API_URL;
  return stored;
}
