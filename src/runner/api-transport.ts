// The ONLY way runner code may reach the family API.
//
// A content script runs at the page's origin (my.uscis.gov), and under MV3
// `host_permissions` do not exempt it from CORS — so a direct `fetch` to the
// family API has its preflight refused and the real request is never sent. All
// API reads therefore go through the service worker (see engine/download-proxy).
//
// Kept in its own SIDE-EFFECT-FREE module so callers are unit-testable by
// stubbing chrome.runtime.sendMessage, and so "who is allowed to call the API"
// stays one grep away.

/** A normalized API result. `ok:false` NEVER means "threw" — see apiGet. */
export interface ApiResult<T = unknown> {
  ok: boolean;
  /** HTTP status when the request reached the server; undefined on transport failure. */
  status?: number;
  data: T | null;
  /** Human-readable reason when ok is false. */
  error?: string;
}

export interface ApiContext {
  apiBaseUrl: string;
  accessToken: string;
}

/**
 * GET a relative API path through the service worker.
 *
 * NEVER REJECTS. Every failure — CORS, offline, service worker asleep, 401, a
 * malformed body — comes back as `{ok:false, error}`. That is the whole point:
 * the previous direct-fetch version rejected on a CORS refusal, and because
 * nothing up the chain caught it (`fillAll` -> `onUploadPage`, and `onFillAll`
 * called as `void`), the walk died as an unhandled rejection with no log line.
 * A resolved failure forces callers to handle it.
 */
export async function apiGet<T = unknown>(
  path: string,
  ctx: ApiContext,
): Promise<ApiResult<T>> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "API_GET",
      apiBaseUrl: ctx.apiBaseUrl,
      path,
      accessToken: ctx.accessToken,
    });
    // A dead/asleep service worker resolves undefined rather than rejecting.
    if (!response) {
      return { ok: false, data: null, error: "No response from the extension background worker" };
    }
    if (response.success) {
      return { ok: true, status: response.status, data: (response.data ?? null) as T };
    }
    return {
      ok: false,
      status: response.status,
      data: null,
      error: String(response.error ?? "Request failed"),
    };
  } catch (err) {
    // chrome.runtime.sendMessage itself can throw when there is no receiver.
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
