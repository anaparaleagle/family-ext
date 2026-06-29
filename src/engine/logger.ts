// Thin debug logger. Writes to console (production builds drop console.* via
// esbuild) and, when present, an in-page debug panel element. Kept minimal —
// the engine should not depend on any UI chrome.
//
// The in-page debug panel is built/owned by the i130 content script
// (createDebugPanel in content.ts); this logger only appends to the panel's
// content element by a well-known id, and keeps a flat buffer so the panel's
// "Copy" button can dump the full log. Mirrors paraleagle-ext's logger.ts.
//
// The buffer is mirrored to chrome.storage.local (key STORAGE_KEY) on every
// dbg() so the full run survives myUSCIS page navigation — both SPA re-renders
// (the panel DOM is rebuilt empty) and full document reloads (the content
// script + this module re-inject and the in-memory buffer resets). On (re)build
// the panel calls hydrateDebugLog() + renderDebugLogInto() to repaint the entire
// run so far instead of only the lines emitted after the rebuild.

const CONTENT_ID = "mk-family-debug-content";
const STORAGE_KEY = "mkFamilyDebugLog";
// Cap the persisted/in-memory history so a long session can't grow unbounded.
// A complete I-130 walk is well under this, so the full run is never truncated.
const MAX_LINES = 500;

// Flat history of every dbg() line this run — backs the panel's Copy button and
// the bulk re-render after a navigation.
export const debugLog: string[] = [];

// True once we've reconciled the in-memory buffer with chrome.storage.local. We
// refuse to persist before this so a fresh (post-reload) context can't clobber
// the stored run with its empty buffer before it has seeded from it.
let hydrated = false;
let hydrating: Promise<void> | null = null;

// chrome.storage.local, or null when chrome is unavailable (unit tests, or a
// context with no storage permission). Keeps the logger usable everywhere.
function localArea(): chrome.storage.LocalStorageArea | null {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
  } catch {
    /* chrome unavailable */
  }
  return null;
}

// Reconcile the in-memory buffer with the persisted one. When the stored run is
// longer than what we hold (a full reload reset us to empty), seed from storage
// so nothing is lost. Idempotent + safe to call on every panel rebuild.
export function hydrateDebugLog(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  const area = localArea();
  if (!area) {
    hydrated = true;
    return Promise.resolve();
  }
  hydrating = new Promise<void>((resolve) => {
    try {
      area.get([STORAGE_KEY], (res) => {
        const stored = (res && (res[STORAGE_KEY] as string[])) || [];
        if (Array.isArray(stored) && stored.length > debugLog.length) {
          debugLog.length = 0;
          debugLog.push(...stored);
        }
        hydrated = true;
        resolve();
      });
    } catch {
      hydrated = true;
      resolve();
    }
  });
  return hydrating;
}

// Mirror the in-memory buffer to storage (last MAX_LINES). No-op until hydrated
// so we never overwrite a longer stored run with our not-yet-seeded buffer.
function persist(): void {
  if (!hydrated) return;
  const area = localArea();
  if (!area) return;
  try {
    area.set({ [STORAGE_KEY]: debugLog.slice(-MAX_LINES) }, () => {
      // Consume any lastError so it doesn't surface as an unchecked warning.
      void chrome.runtime?.lastError;
    });
  } catch {
    /* storage write failed — non-fatal */
  }
}

// Clear both the in-memory buffer and the persisted run (Clear button).
export function resetDebugLog(): void {
  debugLog.length = 0;
  const area = localArea();
  if (!area) return;
  try {
    area.remove(STORAGE_KEY, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    /* ignore */
  }
}

// Per-line coloring — shared by the live append (dbg) and the bulk re-render
// (renderDebugLogInto) so the two never drift.
function applyLineStyle(line: HTMLElement, msg: string): void {
  if (msg.includes("ERROR") || msg.includes("STOPPED") || msg.includes("FAIL")) {
    line.style.color = "#f87171";
  } else if (
    msg.includes("NO MATCH") ||
    msg.includes("No ") ||
    msg.includes("no ") ||
    msg.includes("not detected") ||
    msg.includes("not found") ||
    msg.includes("skipping")
  ) {
    line.style.color = "#fbbf24";
  }
}

// Repaint the entire buffer into a freshly (re)built panel content element.
// Called after a navigation wipes + rebuilds the panel so the user always sees
// the whole run so far, not just lines emitted after the rebuild.
export function renderDebugLogInto(content: HTMLElement): void {
  content.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const msg of debugLog) {
    const line = document.createElement("div");
    applyLineStyle(line, msg);
    line.textContent = msg;
    frag.appendChild(line);
  }
  content.appendChild(frag);
  content.scrollTop = content.scrollHeight;
}

export function dbg(...args: unknown[]): void {
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  debugLog.push(msg);
  if (debugLog.length > MAX_LINES) debugLog.splice(0, debugLog.length - MAX_LINES);
  persist();
  // eslint-disable-next-line no-console
  console.log("[MK-Family]", msg);

  const content = typeof document !== "undefined" ? document.getElementById(CONTENT_ID) : null;
  if (!content) return;
  const line = document.createElement("div");
  applyLineStyle(line, msg);
  line.textContent = msg;
  content.appendChild(line);
  content.scrollTop = content.scrollHeight;
}
