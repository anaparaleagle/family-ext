// Thin debug logger. Writes to console (production builds drop console.* via
// esbuild) and, when present, an in-page debug panel element. Kept minimal —
// the engine should not depend on any UI chrome.

const PANEL_ID = "mk-family-debug-log";

export function dbg(...args: unknown[]): void {
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  // eslint-disable-next-line no-console
  console.log("[MK-Family]", msg);
  const panel = typeof document !== "undefined" ? document.getElementById(PANEL_ID) : null;
  if (panel) {
    const line = document.createElement("div");
    line.textContent = msg;
    panel.appendChild(line);
  }
}
