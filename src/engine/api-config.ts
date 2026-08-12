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

/** One choice in the popup's Backend dropdown. */
export interface ApiEnvOption {
  label: string;
  url: string;
}

const LOCAL_OPTION: ApiEnvOption = { label: "Local (8001)", url: DEFAULT_API_URL };
const PROD_OPTION: ApiEnvOption = { label: "Production", url: PROD_API_URL };

/**
 * Every origin ANY build may offer. The subset a PARTICULAR build may offer is
 * allowedApiOrigins() — that is what the popup checks against. The retired host
 * is deliberately absent from both: a stale stored value is migrated to
 * PROD_API_URL before it is ever checked, so dropping the dead origin strands
 * no one.
 */
export const ALLOWED_API_ORIGINS = [PROD_OPTION, LOCAL_OPTION].map((o) => new URL(o.url).origin);

/**
 * Does this build hold a localhost host permission?
 *
 * The checked-in manifest is the STORE manifest and has none; `npm run watch`
 * adds `http://localhost/*` back (esbuild.config.mjs). A Chrome match pattern
 * has no port component, so that one entry covers :8001 as well.
 */
function grantsLocalhost(hostPermissions: string[]): boolean {
  return hostPermissions.some((p) => p.includes("://localhost"));
}

/**
 * The Backend choices to offer, derived from the manifest the popup is running
 * under. This is the whole point of deriving rather than hardcoding: a published
 * build cannot fetch localhost, so it must not offer it — offering it produces an
 * opaque connection error instead of an explanation.
 */
export function apiEnvOptions(hostPermissions: string[]): ApiEnvOption[] {
  return grantsLocalhost(hostPermissions) ? [LOCAL_OPTION, PROD_OPTION] : [PROD_OPTION];
}

/** The origins a request may target in THIS build. */
export function allowedApiOrigins(hostPermissions: string[]): string[] {
  return apiEnvOptions(hostPermissions).map((o) => new URL(o.url).origin);
}

/**
 * The base URL to use: healed of a retired host, and never a host this build
 * cannot reach.
 *
 * Storage survives an update, so a value stored by an older build can name an
 * origin the current one has no permission for (localhost, after the store build
 * dropped it). Fall back to the first OFFERED option rather than keep it — which
 * is Production in a store build, and Local on a laptop, i.e. the same default
 * each build wants anyway.
 */
export function resolveApiBaseUrl(
  stored: string | undefined,
  hostPermissions: string[],
): string {
  const migrated = migrateApiBaseUrl(stored);
  const options = apiEnvOptions(hostPermissions);
  return options.some((o) => o.url === migrated) ? migrated : options[0].url;
}

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
