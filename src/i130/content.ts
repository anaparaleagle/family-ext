// I-130 content script (isolated world). Renders a small toolbar on the online
// Petition-for-a-Relative form, reads the stored payload, and drives the fill.
// All form knowledge lives in the i130 layer; all DOM-setting in the engine.
// This file is glue + UI only.

import { dbg, debugLog, resetDebugLog, hydrateDebugLog, renderDebugLogInto } from "../engine/logger";
import { detectCurrentPage } from "./section-detector";
import { fillAll, fillPage } from "./fill-chain";
import { descriptorForPath, fillUploadPage } from "./doc-flow";
import { STORAGE_KEYS } from "./payload";
import { FormPage } from "./form-descriptor";

const FORM_HOST_PATH = "/forms/petition-for-a-relative/";

function onI130Form(): boolean {
  return window.location.pathname.includes(FORM_HOST_PATH);
}

interface LoadedPayload {
  fieldValues: Record<string, string>;
  uploadPages: import("./payload").UploadPageDescriptor[];
  caseId: string;
  accessToken: string;
  apiBaseUrl: string;
}

async function loadPayload(): Promise<LoadedPayload | null> {
  const s = await chrome.storage.local.get([
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.uploadPages,
    STORAGE_KEYS.caseId,
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.apiBaseUrl,
  ]);
  const fieldValues = s[STORAGE_KEYS.fieldValues] as Record<string, string> | undefined;
  if (!fieldValues || Object.keys(fieldValues).length === 0) return null;
  return {
    fieldValues,
    uploadPages: (s[STORAGE_KEYS.uploadPages] as LoadedPayload["uploadPages"]) ?? [],
    caseId: (s[STORAGE_KEYS.caseId] as string) ?? "",
    accessToken: (s[STORAGE_KEYS.accessToken] as string) ?? "",
    apiBaseUrl: (s[STORAGE_KEYS.apiBaseUrl] as string) ?? "http://localhost:8001/api/v1",
  };
}

async function handleUploadPage(page: FormPage, payload: LoadedPayload): Promise<void> {
  const descriptor = descriptorForPath(page.slug, payload.uploadPages);
  if (!descriptor) {
    dbg(`upload: no descriptor for ${page.slug}, skipping`);
    return;
  }
  const result = await fillUploadPage(descriptor, {
    apiBaseUrl: payload.apiBaseUrl,
    accessToken: payload.accessToken,
    caseId: payload.caseId,
  });
  setStatus(`Upload ${page.slug}: ${result.attached} attached`);
  for (const w of result.warnings) dbg(`upload: ${w}`);
}

// ── Toolbar UI ──────────────────────────────────────────────────────────────
//
// Parity with paraleagle-ext's I-129 toolbar: a draggable + minimizable bar
// plus an in-page debug-log panel. IDs are namespaced `mk-family-*`. The toolbar
// position and collapsed state are persisted to chrome.storage.local so they
// survive myUSCIS SPA route changes (which wipe + rebuild the toolbar).

const TOOLBAR_ID = "mk-family-toolbar";
const BADGE_ID = "mk-family-badge";
const TOOLBAR_POS_KEY = "mkFamilyToolbarPos";
const TOOLBAR_COLLAPSED_KEY = "mkFamilyToolbarCollapsed";

let statusEl: HTMLElement | null = null;

function setStatus(msg: string): void {
  const el = statusEl ?? document.getElementById("mk-family-status");
  if (el) el.textContent = msg;
  dbg(msg);
}

// ── Position helpers (ported from paraleagle-ext) ─────────────────────────────

// Clamp a toolbar position so it stays inside the current viewport, with a
// small safety margin. Used when restoring a saved position after the user
// resizes the window between sessions.
function clampPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

// Apply a stored position to the toolbar (or badge) — converts any right/top
// anchor to left/top so drag handling is uniform.
function applyPosition(el: HTMLElement, pos: { x: number; y: number } | null): void {
  if (!pos) return;
  const clamped = clampPosition(pos.x, pos.y, el.offsetWidth || 220, el.offsetHeight || 80);
  el.style.left = `${clamped.x}px`;
  el.style.top = `${clamped.y}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

// Wire pointer-based drag on a handle element; the target is moved via
// position: fixed top/left and the final coords are persisted to storage.
function makeDraggable(target: HTMLElement, handle: HTMLElement): void {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (e) => {
    // Skip drag if the user pressed on a button/select nested in the handle.
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === "button" || tag === "select" || tag === "input") return;
    dragging = true;
    const rect = target.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    // Lock the toolbar to top/left the moment a drag starts so the first
    // pointermove doesn't snap from a right/top anchor.
    target.style.left = `${rect.left}px`;
    target.style.top = `${rect.top}px`;
    target.style.right = "auto";
    target.style.bottom = "auto";
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = "grabbing";
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    const clamped = clampPosition(x, y, target.offsetWidth, target.offsetHeight);
    target.style.left = `${clamped.x}px`;
    target.style.top = `${clamped.y}px`;
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = "grab";
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const rect = target.getBoundingClientRect();
    chrome.storage.local.set({ [TOOLBAR_POS_KEY]: { x: rect.left, y: rect.top } });
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

// ── Minimize / restore ────────────────────────────────────────────────────────

// Create the collapsed-state badge: a small clickable pill that re-expands the
// toolbar when clicked. Shares the same stored position as the toolbar.
function createBadge(): HTMLDivElement {
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.title = "Click to expand the ParaLeagle I-130 toolbar";
  badge.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:2147483647;display:none;align-items:center;" +
    "gap:4px;padding:6px 12px;background:#0b3d91;color:#fff;border-radius:999px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.3);font:700 12px/1 system-ui,sans-serif;" +
    "cursor:pointer;user-select:none;";
  badge.textContent = "I-130 ▲"; // ▲
  badge.addEventListener("click", () => {
    void expandToolbar();
  });
  return badge;
}

async function collapseToolbar(): Promise<void> {
  const toolbar = document.getElementById(TOOLBAR_ID);
  const badge = document.getElementById(BADGE_ID);
  if (!toolbar || !badge) return;
  // Copy the toolbar's current screen position onto the badge so it stays put.
  const rect = toolbar.getBoundingClientRect();
  badge.style.left = `${rect.left}px`;
  badge.style.top = `${rect.top}px`;
  badge.style.right = "auto";
  badge.style.bottom = "auto";
  toolbar.style.display = "none";
  badge.style.display = "inline-flex";
  await chrome.storage.local.set({ [TOOLBAR_COLLAPSED_KEY]: true });
}

async function expandToolbar(): Promise<void> {
  const toolbar = document.getElementById(TOOLBAR_ID);
  const badge = document.getElementById(BADGE_ID);
  if (!toolbar || !badge) return;
  // Restore the toolbar at the badge's current position.
  const rect = badge.getBoundingClientRect();
  toolbar.style.left = `${rect.left}px`;
  toolbar.style.top = `${rect.top}px`;
  toolbar.style.right = "auto";
  toolbar.style.bottom = "auto";
  badge.style.display = "none";
  toolbar.style.display = "flex";
  await chrome.storage.local.set({ [TOOLBAR_COLLAPSED_KEY]: false });
}

// ── Debug log panel (ported from paraleagle-ext) ──────────────────────────────

const DEBUG_PANEL_ID = "mk-family-debug-panel";
const DEBUG_CONTENT_ID = "mk-family-debug-content";

function createDebugPanel(): HTMLDivElement {
  const existing = document.getElementById(DEBUG_PANEL_ID) as HTMLDivElement | null;
  if (existing) return existing;

  const panel = document.createElement("div");
  panel.id = DEBUG_PANEL_ID;
  panel.style.cssText =
    "position:fixed;top:12px;left:12px;z-index:2147483647;width:460px;" +
    "background:rgba(15,15,25,.92);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);" +
    "font:11px/1.5 'SF Mono','Fira Code',Consolas,monospace;color:#e2e8f0;display:none;overflow:hidden;";

  const titleBar = document.createElement("div");
  titleBar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;" +
    "background:rgba(30,30,50,.95);border-bottom:1px solid rgba(255,255,255,.1);";

  const title = document.createElement("span");
  title.textContent = "ParaLeagle I-130 Log";
  title.style.cssText = "font-weight:600;font-size:11px;color:#94a3b8;";

  const btnGroup = document.createElement("div");
  btnGroup.style.cssText = "display:flex;gap:6px;";

  const copyBtn = panelButton("Copy", "#2563eb");
  copyBtn.addEventListener("click", () => {
    // Seed from storage first so a just-reloaded context copies the whole run,
    // not just this page's lines.
    void hydrateDebugLog().then(() => {
      navigator.clipboard.writeText(debugLog.join("\n")).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1500);
      });
    });
  });

  const clearBtn = panelButton("Clear", "#475569");
  clearBtn.addEventListener("click", () => {
    resetDebugLog();
    const content = document.getElementById(DEBUG_CONTENT_ID);
    if (content) content.innerHTML = "";
  });

  const closeBtn = panelButton("×", "transparent");
  closeBtn.style.color = "#94a3b8";
  closeBtn.style.fontSize = "14px";
  closeBtn.addEventListener("click", () => hideDebugPanel());

  btnGroup.append(copyBtn, clearBtn, closeBtn);
  titleBar.append(title, btnGroup);

  const content = document.createElement("div");
  content.id = DEBUG_CONTENT_ID;
  content.style.cssText =
    "max-height:250px;overflow-y:auto;padding:6px 10px;white-space:pre-wrap;word-break:break-all;line-height:1.5;";

  panel.append(titleBar, content);
  document.body.appendChild(panel);

  // This panel was just (re)built — on an SPA route change it's recreated empty,
  // and after a full reload the in-memory buffer reset. Seed from storage (if a
  // reload wiped us) and repaint the entire run so far into the fresh content
  // element, so the panel always shows the whole walk, not just new lines.
  void hydrateDebugLog().then(() => renderDebugLogInto(content));
  return panel;
}

function panelButton(label: string, bg: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    `padding:2px 8px;background:${bg};color:#fff;border:none;border-radius:4px;` +
    "font-size:10px;cursor:pointer;font-family:inherit;";
  return b;
}

function showDebugPanel(): void {
  createDebugPanel().style.display = "block";
}

function hideDebugPanel(): void {
  const panel = document.getElementById(DEBUG_PANEL_ID);
  if (panel) panel.style.display = "none";
}

function toggleDebugPanel(): void {
  const panel = document.getElementById(DEBUG_PANEL_ID);
  if (panel && panel.style.display !== "none") hideDebugPanel();
  else showDebugPanel();
}

// ── Toolbar ────────────────────────────────────────────────────────────────

function buildToolbar(): void {
  // Ensure the debug panel exists so dbg() output has somewhere to land.
  createDebugPanel();

  const haveToolbar = !!document.getElementById(TOOLBAR_ID);
  const haveBadge = !!document.getElementById(BADGE_ID);
  if (haveToolbar && haveBadge) return; // already mounted — leave state untouched

  if (!haveBadge) document.body.appendChild(createBadge());
  if (!haveToolbar) document.body.appendChild(createToolbar());

  // Restore saved position + collapsed state after mount (so offsetWidth/Height
  // are measurable for clamping). Mirrors paraleagle-ext's init().
  void restoreToolbarState();
}

function createToolbar(): HTMLDivElement {
  const bar = document.createElement("div");
  bar.id = TOOLBAR_ID;
  bar.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:2147483647;background:#0b3d91;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);" +
    "display:flex;flex-direction:column;gap:6px;min-width:200px;";

  // Header row doubles as the drag handle (makeDraggable skips nested buttons).
  const header = document.createElement("div");
  header.id = "mk-family-drag-handle";
  header.title = "Drag to move toolbar";
  header.style.cssText =
    "display:flex;align-items:center;gap:6px;cursor:grab;user-select:none;";

  const grip = document.createElement("span");
  grip.textContent = "⋮⋮"; // ⋮⋮
  grip.style.cssText = "color:#cbd5e1;font-size:15px;font-weight:700;letter-spacing:-2px;line-height:1;";

  const title = document.createElement("div");
  title.textContent = "ParaLeagle I-130";
  title.style.cssText = "font-weight:600;flex:1;";

  const logsBtn = headerButton("Logs", "Show the debug log panel");
  logsBtn.addEventListener("click", toggleDebugPanel);

  const minBtn = headerButton("–", "Minimize toolbar (click badge to restore)"); // – en dash
  minBtn.style.minWidth = "24px";
  minBtn.addEventListener("click", () => {
    void collapseToolbar();
  });

  header.append(grip, title, logsBtn, minBtn);
  bar.appendChild(header);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;";
  btnRow.appendChild(button("Fill section", onFillSection));
  btnRow.appendChild(button("Fill all", onFillAll));
  bar.appendChild(btnRow);

  statusEl = document.createElement("div");
  statusEl.id = "mk-family-status";
  statusEl.style.cssText = "font-size:12px;opacity:.9;";
  statusEl.textContent = "Ready";
  bar.appendChild(statusEl);

  makeDraggable(bar, header);
  return bar;
}

async function restoreToolbarState(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([TOOLBAR_POS_KEY, TOOLBAR_COLLAPSED_KEY]);
    const savedPos = stored[TOOLBAR_POS_KEY] as { x: number; y: number } | undefined;
    const isCollapsed = !!stored[TOOLBAR_COLLAPSED_KEY];

    const toolbar = document.getElementById(TOOLBAR_ID) as HTMLElement | null;
    const badge = document.getElementById(BADGE_ID) as HTMLElement | null;

    if (savedPos && toolbar) applyPosition(toolbar, savedPos);
    if (savedPos && badge) applyPosition(badge, savedPos);

    if (isCollapsed && toolbar && badge) {
      toolbar.style.display = "none";
      badge.style.display = "inline-flex";
    }
  } catch (err) {
    dbg(`toolbar: failed to restore state — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Small header-row button (Logs / minimize).
function headerButton(label: string, titleText: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = titleText;
  b.style.cssText =
    "cursor:pointer;border:1px solid rgba(255,255,255,.4);border-radius:5px;padding:2px 8px;" +
    "background:rgba(255,255,255,.12);color:#fff;font:600 11px/1 system-ui,sans-serif;";
  b.addEventListener("mouseenter", () => {
    b.style.background = "rgba(255,255,255,.25)";
  });
  b.addEventListener("mouseleave", () => {
    b.style.background = "rgba(255,255,255,.12)";
  });
  return b;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    "flex:1;cursor:pointer;border:0;border-radius:5px;padding:5px 8px;background:#fff;color:#0b3d91;font-weight:600;";
  b.addEventListener("click", onClick);
  return b;
}

async function onFillSection(): Promise<void> {
  const payload = await loadPayload();
  if (!payload) return setStatus("No data loaded — open the popup and load a case.");
  const page = detectCurrentPage();
  if (!page) return setStatus("Not on a recognized I-130 page.");
  if (page.kind === "upload") {
    await handleUploadPage(page, payload);
    return;
  }
  if (page.kind === "review") return setStatus("Review page — nothing to fill.");
  const res = await fillPage(page, payload.fieldValues);
  setStatus(`${page.title}: ${res.filled}/${res.total} filled`);
}

async function onFillAll(): Promise<void> {
  const payload = await loadPayload();
  if (!payload) return setStatus("No data loaded — open the popup and load a case.");
  setStatus("Filling all pages…");
  const summaries = await fillAll(payload.fieldValues, (page) => handleUploadPage(page, payload));
  const filled = summaries.reduce((n, s) => n + s.filled, 0);
  const total = summaries.reduce((n, s) => n + s.total, 0);
  setStatus(`Done — ${filled}/${total} fields across ${summaries.length} pages`);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function boot(): void {
  if (!onI130Form()) return;
  buildToolbar();
}

// myUSCIS is an SPA — re-check on route changes (and whenever the SPA wiped the
// toolbar out of the DOM) so the toolbar persists. buildToolbar() restores the
// saved position + collapsed state on rebuild, so it never snaps back to the
// corner.
let lastPath = "";
function watchRoute(): void {
  const path = window.location.pathname;
  const onForm = onI130Form();
  const wiped = onForm && !document.getElementById("mk-family-toolbar");
  if (path !== lastPath || wiped) {
    lastPath = path;
    if (onForm) buildToolbar();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
setInterval(watchRoute, 1000);
