// myUSCIS content script (isolated world). Renders a small toolbar on any guided
// online form the registry knows about, reads the stored payload, and drives the
// fill.
//
// Form-agnostic orchestrator: it picks the FormConfig whose hostPath matches the
// current URL, and everything downstream (toolbar label, page detection, the
// walk) is driven by that config. All form knowledge lives in the descriptors;
// all DOM-setting in the engine. This file is glue + UI only.

import { dbg, debugLog, resetDebugLog, hydrateDebugLog, renderDebugLogInto } from "../engine/logger";
import { detectCurrentPage } from "./section-detector";
import { fillAll, fillPage, onLoginPage } from "./fill-chain";
import { auditPage, summarizeAudit } from "./audit";
import { descriptorsForPath, fillUploadPageAll } from "./doc-flow";
import { STORAGE_KEYS } from "./payload";
import { configForPath } from "./registry";
import { FormConfig, FormPage } from "./types";

/** The form this page belongs to, or null when we're not on one of ours. */
function currentConfig(): FormConfig | null {
  return configForPath(window.location.pathname);
}

interface LoadedPayload {
  fieldValues: Record<string, string>;
  uploadPages: import("./payload").UploadPageDescriptor[];
  caseId: string;
  formType: string;
  accessToken: string;
  apiBaseUrl: string;
}

async function loadPayload(): Promise<LoadedPayload | null> {
  const s = await chrome.storage.local.get([
    STORAGE_KEYS.fieldValues,
    STORAGE_KEYS.uploadPages,
    STORAGE_KEYS.caseId,
    STORAGE_KEYS.formType,
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.apiBaseUrl,
  ]);
  const fieldValues = s[STORAGE_KEYS.fieldValues] as Record<string, string> | undefined;
  if (!fieldValues || Object.keys(fieldValues).length === 0) return null;
  return {
    fieldValues,
    uploadPages: (s[STORAGE_KEYS.uploadPages] as LoadedPayload["uploadPages"]) ?? [],
    caseId: (s[STORAGE_KEYS.caseId] as string) ?? "",
    formType: (s[STORAGE_KEYS.formType] as string) ?? "",
    accessToken: (s[STORAGE_KEYS.accessToken] as string) ?? "",
    apiBaseUrl: (s[STORAGE_KEYS.apiBaseUrl] as string) ?? "http://localhost:8001/api/v1",
  };
}

/**
 * Load the payload and check it belongs to the form on screen. Returns null (and
 * sets a status) when there's nothing loaded, or when the loaded case was
 * resolved for a DIFFERENT form — an I-539 payload cannot fill an I-130, the
 * Formik names don't overlap, so it would silently record 0/N on every page.
 */
async function loadPayloadFor(config: FormConfig): Promise<LoadedPayload | null> {
  const payload = await loadPayload();
  if (!payload) {
    setStatus("No data loaded — open the popup and load a case.");
    return null;
  }
  if (payload.formType && payload.formType !== config.formType) {
    setStatus(
      `Loaded data is for ${payload.formType}, but this is the ${config.formType} form. ` +
        `Open the popup and load the case for ${config.formType}.`,
    );
    return null;
  }
  return payload;
}

/**
 * Resolve + attach the files for one upload page.
 *
 * NEVER THROWS. `fillAll` awaits this inside its page loop, and `onFillAll` is
 * fired as `void onFillAll()` — so an escaping rejection became an unhandled
 * rejection that ended the walk mid-run with NO log line at all. That is how the
 * doc-upload CORS failure hid: the debug log simply stopped after the last filled
 * page. Anything unexpected in here is logged and reported, not thrown.
 */
async function handleUploadPage(page: FormPage, payload: LoadedPayload): Promise<void> {
  // ALL descriptors for this page, not just the first — one evidence slot can be
  // fed by several document types (see fillUploadPageAll).
  const descriptors = descriptorsForPath(page.slug, payload.uploadPages);
  if (descriptors.length === 0) {
    dbg(`upload: no descriptor for ${page.slug}, skipping`);
    return;
  }
  try {
    const result = await fillUploadPageAll(descriptors, {
      apiBaseUrl: payload.apiBaseUrl,
      accessToken: payload.accessToken,
      caseId: payload.caseId,
    });
    // SOF-1005: name the already-attached files too, or a correct re-run reads as
    // "0 attached" and looks broken.
    const skipped = result.alreadyAttached
      ? `, ${result.alreadyAttached} already attached`
      : "";
    setStatus(`Upload ${page.slug}: ${result.attached} attached${skipped}`);
    for (const w of result.warnings) dbg(`upload: ${w}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Upload ${page.slug}: failed`);
    dbg(`upload: No file attached to ${page.slug} — unexpected error: ${message}`);
  }
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
    saveUiState({ [TOOLBAR_POS_KEY]: { x: rect.left, y: rect.top } });
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

// ── Minimize / restore ────────────────────────────────────────────────────────

// Create the collapsed-state badge: a small clickable pill that re-expands the
// toolbar when clicked. Shares the same stored position as the toolbar.
function createBadge(config: FormConfig): HTMLDivElement {
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("role", "button");
  badge.setAttribute("tabindex", "0");
  badge.title = `Expand the ${config.label} toolbar`;
  badge.setAttribute("aria-label", `Expand the ${config.label} toolbar`);
  badge.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:2147483647;display:none;align-items:center;" +
    "gap:4px;padding:6px 12px;background:#0b3d91;color:#fff;border-radius:999px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.3);font:700 12px/1 system-ui,sans-serif;" +
    "cursor:pointer;user-select:none;";
  badge.textContent = `${config.formType} ▲`; // ▲
  badge.addEventListener("click", () => {
    void expandToolbar();
  });
  badge.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void expandToolbar();
    }
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
  saveUiState({ [TOOLBAR_COLLAPSED_KEY]: true });
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
  saveUiState({ [TOOLBAR_COLLAPSED_KEY]: false });
}

// ── Debug log panel (ported from paraleagle-ext) ──────────────────────────────

const DEBUG_PANEL_ID = "mk-family-debug-panel";
const DEBUG_CONTENT_ID = "mk-family-debug-content";

function createDebugPanel(config: FormConfig): HTMLDivElement {
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
  title.textContent = `${config.label} Log`;
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
  closeBtn.setAttribute("aria-label", "Close the log panel");
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
  const config = currentConfig();
  if (config) createDebugPanel(config).style.display = "block";
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

function buildToolbar(config: FormConfig): void {
  // Ensure the debug panel exists so dbg() output has somewhere to land.
  createDebugPanel(config);

  const haveToolbar = !!document.getElementById(TOOLBAR_ID);
  const haveBadge = !!document.getElementById(BADGE_ID);
  if (haveToolbar && haveBadge) return; // already mounted — leave state untouched

  if (!haveBadge) document.body.appendChild(createBadge(config));
  if (!haveToolbar) document.body.appendChild(createToolbar(config));

  // Restore saved position + collapsed state after mount (so offsetWidth/Height
  // are measurable for clamping). Mirrors paraleagle-ext's init().
  void restoreToolbarState();
}

function createToolbar(config: FormConfig): HTMLDivElement {
  const bar = document.createElement("div");
  bar.id = TOOLBAR_ID;
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", `${config.label} autofill toolbar`);
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
  grip.setAttribute("aria-hidden", "true");
  grip.style.cssText = "color:#cbd5e1;font-size:15px;font-weight:700;letter-spacing:-2px;line-height:1;";

  const title = document.createElement("div");
  title.textContent = config.label;
  title.style.cssText = "font-weight:600;flex:1;";

  const logsBtn = headerButton("Logs", "Show the debug log panel");
  logsBtn.addEventListener("click", toggleDebugPanel);

  const minBtn = headerButton("–", "Minimize toolbar (click badge to restore)"); // – en dash
  minBtn.setAttribute("aria-label", "Minimize toolbar");
  minBtn.style.minWidth = "24px";
  minBtn.addEventListener("click", () => {
    void collapseToolbar();
  });

  header.append(grip, title, logsBtn, minBtn);
  bar.appendChild(header);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;";
  btnRow.appendChild(
    button("Fill section", "Fill only the page you are on", () => void onFillSection()),
  );
  btnRow.appendChild(
    button("Fill all", `Fill every ${config.formType} page from here to Review`, () => void onFillAll()),
  );
  bar.appendChild(btnRow);

  const auditRow = document.createElement("div");
  auditRow.style.cssText = "display:flex;gap:6px;";
  auditRow.appendChild(
    button(
      "Audit page",
      "Compare this page's fields against the descriptor — catches USCIS renames",
      () => void onAuditPage(),
      "secondary",
    ),
  );
  bar.appendChild(auditRow);

  statusEl = document.createElement("div");
  statusEl.id = "mk-family-status";
  // Announce status changes to screen readers without stealing focus.
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
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

function button(
  label: string,
  titleText: string,
  onClick: () => void,
  variant: "primary" | "secondary" = "primary",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = titleText;
  b.style.cssText =
    "flex:1;cursor:pointer;border-radius:5px;padding:5px 8px;font-weight:600;" +
    (variant === "primary"
      ? "border:0;background:#fff;color:#0b3d91;"
      : "border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;");
  b.addEventListener("click", onClick);
  return b;
}

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * True while a fill is running. Guards against a SECOND concurrent run.
 *
 * Clicking Fill all twice used to start two independent walks in the same tab, and
 * they raced: on 2026-07-29 both downloaded the same 10MB I-20 and both injected
 * it, because each checked "is this file already on the page" before the other's
 * row had rendered. USCIS ended up holding form_i20.pdf twice. No amount of
 * de-dupe fixes that — two runs checking simultaneously will both see nothing.
 *
 * The button going quiet during a large download is exactly when someone clicks it
 * again, so this is the common case, not an edge case.
 */
let fillInProgress = false;

/** Run `body` unless a fill is already going. Always releases the lock. */
async function withRunLock(what: string, body: () => Promise<void>): Promise<void> {
  if (fillInProgress) {
    setStatus(`${what} is already running — wait for it to finish.`);
    return;
  }
  fillInProgress = true;
  try {
    await body();
  } catch (err) {
    // A throw here used to end the run with NO log line at all — no stop reason,
    // no summary, nothing. Indistinguishable from "still working", which is
    // exactly what made a stall impossible to diagnose. Every run now ends with a
    // line saying how it ended.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? (err.stack.split(/\r?\n/)[1] ?? "").trim() : "";
    setStatus(`${what} stopped on an error: ${message}`);
    dbg(`ERROR: ${what} threw — ${message}${stack ? ` (${stack})` : ""}`);
  } finally {
    fillInProgress = false;
  }
}

async function fillSectionBody(): Promise<void> {
  const config = currentConfig();
  if (!config) return setStatus("Not on a ParaLeagle-supported myUSCIS form.");
  if (onLoginPage()) {
    return setStatus("myUSCIS is signed out. Sign in, reopen the draft, then try again.");
  }
  const payload = await loadPayloadFor(config);
  if (!payload) return;
  const page = detectCurrentPage(config.pages);
  if (!page) return setStatus(`Not on a recognized ${config.formType} page.`);
  if (page.kind === "upload") {
    await handleUploadPage(page, payload);
    return;
  }
  if (page.kind === "review") return setStatus("Review page — nothing to fill.");
  const res = await fillPage(page, payload.fieldValues);
  setStatus(
    `${page.title}: ${res.filled}/${res.total} filled` +
      (res.skipped ? ` (${res.skipped} not shown)` : ""),
  );
}

/**
 * Stamp the top of every run with what is actually running.
 *
 * The extension VERSION is here for one blunt reason: a run diagnosed from a
 * pasted log is worthless if nobody can tell which build produced it, and
 * "I reloaded it" is not evidence. If the version line is missing or old, stop
 * reading the log and reload the extension.
 *
 * Deliberately no field VALUES — this log gets pasted around, and the case holds
 * an SSN, a passport number and a home address. Names, counts and outcomes are
 * enough to diagnose from.
 */
function logRunHeader(config: FormConfig, payload: LoadedPayload): void {
  let version = "unknown";
  try {
    version = chrome.runtime?.getManifest?.().version ?? "unknown";
  } catch {
    /* not in an extension context */
  }
  dbg("══════════════════════════════════════════════");
  dbg(`ParaLeagle family autofill v${version} — ${config.formType}`);
  dbg(`  case: ${payload.caseId}`);
  dbg(`  api:  ${payload.apiBaseUrl}`);
  dbg(`  page: ${window.location.pathname}`);
  dbg(`  payload: ${Object.keys(payload.fieldValues).length} field values, ` +
      `${payload.uploadPages.length} upload page(s)`);
  if (payload.uploadPages.length) {
    // DISTINCT paths with a count, not the raw list. The Additional-evidence
    // catch-all expands to one descriptor per doc_type, so the raw list printed
    // "/evidence/additional-evidence" 83 times and buried the whole header.
    const byPath = new Map<string, number>();
    for (const u of payload.uploadPages) {
      byPath.set(u.page_path, (byPath.get(u.page_path) ?? 0) + 1);
    }
    const slots = [...byPath.entries()]
      .map(([path, n]) => (n > 1 ? `${path} (${n} doc types)` : path))
      .join(", ");
    dbg(`  upload slots: ${slots}`);
  }
  dbg("══════════════════════════════════════════════");
}

async function fillAllBody(): Promise<void> {
  const config = currentConfig();
  if (!config) return setStatus("Not on a ParaLeagle-supported myUSCIS form.");
  if (onLoginPage()) {
    return setStatus("myUSCIS is signed out. Sign in, reopen the draft, then try again.");
  }
  const payload = await loadPayloadFor(config);
  if (!payload) return;
  logRunHeader(config, payload);
  setStatus("Filling all pages…");
  const summaries = await fillAll(config, payload.fieldValues, (page) =>
    handleUploadPage(page, payload),
  );
  const filled = summaries.reduce((n, s) => n + s.filled, 0);
  const total = summaries.reduce((n, s) => n + s.total, 0);
  setStatus(`Done — ${filled}/${total} fields across ${summaries.length} pages`);
}

async function onFillSection(): Promise<void> {
  return withRunLock("A fill", fillSectionBody);
}

async function onFillAll(): Promise<void> {
  return withRunLock("Fill all", fillAllBody);
}

/**
 * Audit the current page: what the descriptor expects vs what's really rendered.
 * This is the early-warning for USCIS renaming Formik fields — without it a
 * rename looks identical to "this case has no data for that field".
 */
async function onAuditPage(): Promise<void> {
  const config = currentConfig();
  if (!config) return setStatus("Not on a ParaLeagle-supported myUSCIS form.");
  const page = detectCurrentPage(config.pages);
  if (!page) {
    setStatus(`Page not in the ${config.formType} descriptor (${window.location.pathname}).`);
    dbg(
      `audit: no descriptor entry for ${window.location.pathname} — either a page we ` +
        `never captured, or USCIS renamed the slug. Capture it and add it to the descriptor.`,
    );
    showDebugPanel();
    return;
  }
  const audit = auditPage(page);
  setStatus(summarizeAudit(audit));
  dbg(`audit: ${summarizeAudit(audit)}`);
  if (audit.missing.length > 0) dbg(`audit: MISSING -> ${audit.missing.join(", ")}`);
  if (audit.extra.length > 0) dbg(`audit: EXTRA (not in descriptor) -> ${audit.extra.join(", ")}`);
  for (const note of audit.notes) dbg(`audit: note — ${note}`);
  showDebugPanel(); // the detail lives in the log, so open it for the user
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function boot(): void {
  const config = currentConfig();
  if (config) buildToolbar(config);
}

// myUSCIS is an SPA — re-check on route changes (and whenever the SPA wiped the
// toolbar out of the DOM) so the toolbar persists. buildToolbar() restores the
// saved position + collapsed state on rebuild, so it never snaps back to the
// corner.
/**
 * False once this content script's extension context has been torn down —
 * which happens every time the extension is reloaded or updated while a myUSCIS
 * tab is still open.
 *
 * The old content script keeps running in that tab, but every chrome.* call now
 * throws "Extension context invalidated". With a 1-second poll that becomes a
 * stream of uncaught errors in the page console, and worse, the DEAD toolbar is
 * still sitting there looking clickable — so Fill all appears to do nothing.
 */
function contextAlive(): boolean {
  try {
    // Reading an id on a dead context throws; on a live one it is a string.
    return typeof chrome.runtime?.id === "string";
  } catch {
    return false;
  }
}

/**
 * Replace the toolbar with a single instruction when the context has died.
 * A dead toolbar that still looks alive is worse than no toolbar: the buttons
 * silently do nothing and it reads as the extension being broken.
 */
function showReloadNotice(): void {
  document.getElementById(TOOLBAR_ID)?.remove();
  document.getElementById(BADGE_ID)?.remove();
  if (document.getElementById("mk-family-stale")) return;
  const note = document.createElement("div");
  note.id = "mk-family-stale";
  note.setAttribute("role", "alert");
  note.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:2147483647;max-width:260px;" +
    "background:#7c2d12;color:#fff;font:13px/1.4 system-ui,sans-serif;" +
    "padding:10px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);";
  note.textContent =
    "ParaLeagle autofill was updated. Reload this page (F5) to use the new " +
    "version — your draft is saved.";
  document.body.appendChild(note);
}

/**
 * Persist a scrap of toolbar UI state, swallowing an invalidated context.
 *
 * Every caller here is fire-and-forget — nobody waits to hear that a toolbar
 * position was saved. That is exactly why these were the source of
 * "Uncaught (in promise) Error: Extension context invalidated" after the
 * extension was reloaded with a myUSCIS tab still open: the promise rejected and
 * there was no handler. Losing a saved position on a dead context is harmless;
 * an uncaught rejection that buries the real message is not.
 */
function saveUiState(items: Record<string, unknown>): void {
  try {
    void chrome.storage.local.set(items)?.catch?.(() => undefined);
  } catch {
    /* context gone — the reload notice covers it */
  }
}

let lastPath = "";
let routeTimer: ReturnType<typeof setInterval> | null = null;

function watchRoute(): void {
  if (!contextAlive()) {
    // Stop polling FIRST: without this the interval keeps firing and every tick
    // throws again, burying the one message that actually tells you what to do.
    if (routeTimer !== null) {
      clearInterval(routeTimer);
      routeTimer = null;
    }
    showReloadNotice();
    return;
  }
  const path = window.location.pathname;
  const config = currentConfig();
  const wiped = !!config && !document.getElementById(TOOLBAR_ID);
  if (path !== lastPath || wiped) {
    lastPath = path;
    if (config) buildToolbar(config);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
routeTimer = setInterval(watchRoute, 1000);
