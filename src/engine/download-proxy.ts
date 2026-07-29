// ===========================================================================
// HARVESTED from paraleagle-ext src/background.ts (origin/main). Service worker
// that proxies authenticated requests so content scripts can talk to the family
// API without tripping CORS. Re-pointed at the family API origins.
// ===========================================================================
//
// WHY EVERY CONTENT-SCRIPT REQUEST MUST COME THROUGH HERE
// ------------------------------------------------------
// A content script runs at the PAGE's origin (my.uscis.gov). Under MV3,
// `host_permissions` do NOT exempt a content script from CORS — only fetches
// made from THIS service worker are privileged. A content script calling the
// family API directly gets its preflight refused and the real request is never
// sent, which is exactly how doc upload silently died: the walk threw on a
// rejected fetch and the debug log just stopped.
//
// paraleagle-ext hit the same wall on flag.dol.gov (SOF-643) and solved it the
// same way — route the call through the worker.
//
// Two message types, deliberately narrow:
//   API_GET       — GET a path on the family API, WITH the caller's bearer token.
//   DOWNLOAD_FILE — GET a file's bytes, from the API *or* from S3 media storage.
//
// Widening either allowlist is a deliberate surface change. Add only origins we
// actually fetch from.

/** Family API origins. Requests here carry the caller's Firebase bearer token. */
const API_ORIGINS = [
  "https://family-api.paraleagle.io",
  "http://localhost:8001",
];

/**
 * S3 media origins, for document/generated-form bytes.
 *
 * Prod stores media on S3 (config/settings/s3.py), so DocumentSerializer.
 * file_url is a PRESIGNED S3 URL, not a path on the API host — verified 2026-07-27
 * from prod request logs (zero legitimate /media/* requests in 30 days).
 *
 * Covers virtual-hosted (`<bucket>.s3[.<region>].amazonaws.com`) and path-style
 * (`s3[.<region>].amazonaws.com/<bucket>`) forms. If AWS_S3_CUSTOM_DOMAIN is
 * ever set to a CloudFront domain, add it here AND to manifest host_permissions —
 * isMediaUrl returning false is reported by name, so a missing origin is loud.
 */
const MEDIA_URL_PATTERN =
  /^https:\/\/([a-z0-9.-]+\.)?s3(\.[a-z0-9-]+)?\.amazonaws\.com\//i;

/** True when this URL is on the family API — the only place our token may go. */
export function isApiUrl(url: string): boolean {
  return API_ORIGINS.some((origin) => url.startsWith(origin));
}

/** True when this URL is S3 media storage (presigned; must NOT carry a token). */
export function isMediaUrl(url: string): boolean {
  return MEDIA_URL_PATTERN.test(url);
}

/** The origin of a URL, for error messages that name what was blocked. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.slice(0, 60);
  }
}

interface ProxyFailure {
  success: false;
  status?: number;
  error: string;
}

function fail(error: string, status?: number): ProxyFailure {
  return status === undefined ? { success: false, error } : { success: false, status, error };
}

/**
 * GET a path on the family API with the caller's bearer token, and return the
 * parsed JSON body alongside the status. Never throws at the caller: a network
 * or CORS failure comes back as {success:false}, because a rejected promise here
 * surfaces in the content script as an unhandled rejection that kills the walk.
 */
function handleApiGet(
  message: { apiBaseUrl?: string; path?: string; accessToken?: string },
  sendResponse: (r: unknown) => void,
): void {
  const { apiBaseUrl, path, accessToken } = message;
  if (!apiBaseUrl || !isApiUrl(apiBaseUrl)) {
    sendResponse(fail(`API base not allowed: ${originOf(String(apiBaseUrl))}`));
    return;
  }
  if (!path || !path.startsWith("/")) {
    sendResponse(fail("API path must start with /"));
    return;
  }
  // Reject a path that tries to escape onto another host via "//evil.com" or a
  // scheme — `new URL()` semantics make those absolute.
  if (path.startsWith("//") || /^\/[a-z][a-z0-9+.-]*:/i.test(path)) {
    sendResponse(fail("API path must be relative"));
    return;
  }

  const base = apiBaseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  fetch(`${base}${path}`, { headers })
    .then((res) =>
      res
        .json()
        .catch(() => null)
        .then((data) => ({ ok: res.ok, status: res.status, data })),
    )
    .then(({ ok, status, data }) =>
      sendResponse(
        ok
          ? { success: true, status, data }
          : fail(`HTTP ${status}`, status),
      ),
    )
    .catch((err) =>
      sendResponse(fail(err instanceof Error ? err.message : String(err))),
    );
}

/**
 * GET a file's bytes and hand them back as a transferable byte array.
 *
 * The bearer token is attached ONLY for API origins. A presigned S3 URL is
 * self-authenticating and must NOT carry our Firebase token — signing it into a
 * request to a bucket host would leak a firm credential to storage.
 */
function handleDownloadFile(
  message: { url?: string; accessToken?: string },
  sendResponse: (r: unknown) => void,
): void {
  const { url, accessToken } = message;
  if (!url) {
    sendResponse(fail("No URL given"));
    return;
  }
  const toApi = isApiUrl(url);
  if (!toApi && !isMediaUrl(url)) {
    sendResponse(
      fail(
        `Download blocked — ${originOf(url)} is not in the extension's allowlist. ` +
          `Add it to download-proxy ALLOWED origins and manifest host_permissions.`,
      ),
    );
    return;
  }

  const headers: Record<string, string> = {};
  if (toApi && accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  fetch(url, { headers })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("Content-Type") || "application/pdf";
      return res.blob().then((blob) => ({ blob, contentType }));
    })
    .then(({ blob, contentType }) =>
      blob.arrayBuffer().then((buffer) => ({
        success: true as const,
        data: Array.from(new Uint8Array(buffer)),
        contentType,
      })),
    )
    .then((result) => sendResponse(result))
    .catch((err) =>
      sendResponse(fail(err instanceof Error ? err.message : String(err))),
    );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_FILE") {
    handleDownloadFile(message, sendResponse);
    return true; // keep channel open for async sendResponse
  }
  if (message?.type === "API_GET") {
    handleApiGet(message, sendResponse);
    return true; // keep channel open for async sendResponse
  }
});
