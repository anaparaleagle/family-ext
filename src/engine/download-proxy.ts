// ===========================================================================
// HARVESTED from paraleagle-ext src/background.ts (origin/main). Service worker
// that proxies authenticated file downloads so content scripts can attach a
// bearer token without tripping CORS. Re-pointed at the family API origins.
// ===========================================================================
//
// The ONLY message it accepts is DOWNLOAD_FILE, and it hard-allowlists the
// download origin. Widening ALLOWED_ORIGINS is a deliberate surface change —
// add only the family API host(s) we actually fetch from.

const ALLOWED_ORIGINS = [
  "https://family-api.paraleagle.io",
  "http://localhost:8001",
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "DOWNLOAD_FILE") {
    const { url, accessToken } = message;
    if (!ALLOWED_ORIGINS.some((origin) => url.startsWith(origin))) {
      sendResponse({ success: false, error: "URL not allowed" });
      return true;
    }

    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
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
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // keep channel open for async sendResponse
  }
});
