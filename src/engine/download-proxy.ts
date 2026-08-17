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

import { ALLOWED_API_ORIGINS } from "./api-config";

/**
 * Family API origins. Requests here carry the caller's Firebase bearer token.
 *
 * Deliberately the same list the popup offers as Backend choices (api-config):
 * kept apart, a backend the popup can select but this worker rejects loads a case
 * and then fails every fill-time read.
 */
const API_ORIGINS = ALLOWED_API_ORIGINS;

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

/**
 * True when this URL is on the family API — the only place our token may go.
 *
 * Compares the PARSED ORIGIN, never a string prefix. A prefix test would accept
 * `https://family-api.paraleagle.io.evil.example/` (it starts with our origin)
 * and hand the firm's bearer token to whoever registered that domain. An
 * unparseable URL is not ours.
 */
export function isApiUrl(url: string): boolean {
  try {
    return API_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
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
 * Base64-encode bytes for the message channel.
 *
 * Chunked deliberately: `String.fromCharCode(...bytes)` spreads every byte into
 * an argument list and throws "too many arguments" on anything past a few
 * hundred KB, which would turn a large-but-legal document into a crash instead
 * of an upload.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32k args per call — comfortably inside the arg limit
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/**
 * GET a file's bytes and hand them back as BASE64.
 *
 * WHY NOT A NUMBER ARRAY (which is what this used to do): chrome.runtime
 * .sendMessage stores each array element as a full number, roughly 8 bytes per
 * byte of file, so a ~10MB PDF arrived as ~80MB and Chrome refused it with
 * "Message exceeded maximum allowed size of 64MiB". Confirmed live on 2026-07-29
 * (FAM-0100): the small I-94 attached, the I-20 did not. USCIS accepts up to
 * 12MB per file, so that ceiling sat well inside normal documents.
 * Base64 costs ~1.37 bytes per byte, putting a 12MB file near 16MB.
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
        dataBase64: toBase64(buffer),
        byteLength: buffer.byteLength,
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
