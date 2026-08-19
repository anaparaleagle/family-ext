// ===========================================================================
// flag.dol.gov content script (isolated world).
//
// A separate entry point from the myUSCIS one, not a branch inside it. The two
// portals share the value-setter and nothing else: different navigation model,
// different payload endpoint, different refusals. Folding FLAG into
// runner/content.ts would mean a page walk with no slugs and a toolbar whose
// every action needed a portal check.
//
// Glue and UI only. Form knowledge lives in the descriptor, DOM work in the
// engine, ordering and refusals in the fill chain.
// ===========================================================================

import { dbg, resetDebugLog } from "../engine/logger";
import { apiGet } from "../runner/api-transport";
import { ETA9141_CONFIG, ETA9141_NOT_AUTOFILLED } from "./eta9141-descriptor";
import { fillAll, fillCurrentSection, WalkReport } from "./fill-chain";
import { FlagFormConfig } from "./types";

const FLAG_CONFIGS: FlagFormConfig[] = [ETA9141_CONFIG];

/** Storage keys for the FLAG side. Separate from the myUSCIS payload keys so a
 * loaded ETA-9141 cannot be mistaken for a loaded I-130 or vice versa. */
const KEYS = {
  fieldValues: "flagFieldValues",
  formType: "flagFormType",
  caseId: "flagCaseId",
  accessToken: "accessToken",
  apiBaseUrl: "apiBaseUrl",
} as const;

function currentConfig(): FlagFormConfig | null {
  return FLAG_CONFIGS.find((c) => c.urlPattern.test(window.location.pathname)) ?? null;
}

// ── payload ─────────────────────────────────────────────────────────────────

interface Loaded {
  fieldValues: Record<string, string>;
  report: Record<string, unknown>;
}

/**
 * Is this content script still attached to a live extension?
 *
 * Reloading the extension ORPHANS every content script already injected into an
 * open tab. The `chrome` object survives but its APIs do not: `chrome.storage`
 * becomes undefined, so the first thing the fill touches dies with
 * "Cannot read properties of undefined (reading 'local')" — a message that says
 * nothing about the actual cause and sends you looking at the storage permission,
 * which is fine. The myUSCIS side already guards this; this one did not, and the
 * first live run on FLAG hit it immediately.
 */
function contextAlive(): boolean {
  try {
    // Reading an id on a dead context throws; on a live one it is a string.
    return typeof chrome.runtime?.id === "string" && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

/**
 * The values for the case the popup selected: what it stored, or a fresh fetch.
 *
 * Any fetch goes through the service worker, never a direct one: a content script
 * runs at the page's origin and under MV3 `host_permissions` do not exempt it from
 * CORS, so a direct call to the family API has its preflight refused. That is
 * documented at length in runner/api-transport, and reusing it is the whole reason
 * this file has no fetch of its own.
 */
async function loadValues(config: FlagFormConfig): Promise<Loaded | null> {
  const stored = await chrome.storage.local.get([
    KEYS.fieldValues,
    KEYS.formType,
    KEYS.caseId,
    KEYS.accessToken,
    KEYS.apiBaseUrl,
  ]);

  // What the popup already loaded wins.
  //
  // The popup is where a caseworker chooses the case and reads the report of
  // what will NOT be filled, so re-fetching here would let the two disagree —
  // fill one set of values while the popup showed another. It also means the fill
  // can be exercised without a login at all, by writing flagFieldValues straight
  // into storage, which is how this gets tested against a live FLAG draft before
  // the backend branch is deployed anywhere.
  const cached = stored[KEYS.fieldValues] as Record<string, string> | undefined;
  const cachedForm = stored[KEYS.formType] as string | undefined;
  if (cached && Object.keys(cached).length) {
    if (cachedForm && cachedForm !== config.formType) {
      setStatus(
        `Loaded data is for ${cachedForm}, but this is the ${config.formType}. ` +
          `Open the popup and load a case for ${config.formType}.`,
      );
      return null;
    }
    return { fieldValues: cached, report: {} };
  }

  const caseId = stored[KEYS.caseId] as string | undefined;
  const accessToken = (stored[KEYS.accessToken] as string) ?? "";
  const apiBaseUrl = (stored[KEYS.apiBaseUrl] as string) ?? "http://localhost:8001/api/v1";

  if (!caseId) {
    setStatus("No case loaded — open the popup and pick a PERM case.");
    return null;
  }

  const path =
    `/forms/eta-autofill/${encodeURIComponent(caseId)}/` +
    `?form=${encodeURIComponent(config.formType)}`;
  const res = await apiGet<{
    field_values: Record<string, string>;
    autofill_report: Record<string, unknown>;
  }>(path, { apiBaseUrl, accessToken });

  if (!res.ok || !res.data) {
    setStatus(`Could not load ${config.formType}: ${res.error ?? "unknown error"}`);
    return null;
  }
  const fieldValues = res.data.field_values ?? {};
  await chrome.storage.local.set({
    [KEYS.fieldValues]: fieldValues,
    [KEYS.formType]: config.formType,
  });
  return { fieldValues, report: res.data.autofill_report ?? {} };
}

// ── toolbar ─────────────────────────────────────────────────────────────────

const TOOLBAR_ID = "mk-flag-toolbar";
const STATUS_ID = "mk-flag-status";
const STALE_ID = "mk-flag-stale";

function setStatus(msg: string): void {
  const el = document.getElementById(STATUS_ID);
  if (el) el.textContent = msg;
  dbg(`status: ${msg}`);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    "margin:2px;padding:6px 10px;border:0;border-radius:4px;cursor:pointer;" +
    "background:#1f4e79;color:#fff;font:12px system-ui";
  b.addEventListener("click", onClick);
  return b;
}

function buildToolbar(config: FlagFormConfig): void {
  if (document.getElementById(TOOLBAR_ID)) return;

  const bar = document.createElement("div");
  bar.id = TOOLBAR_ID;
  bar.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;" +
    "border:1px solid #ccd;border-radius:6px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);" +
    "font:12px system-ui;max-width:320px";

  const title = document.createElement("div");
  title.textContent = config.label;
  title.style.cssText = "font-weight:600;margin-bottom:4px";
  bar.appendChild(title);

  bar.appendChild(button("Fill this section", () => void onFillSection(config)));
  bar.appendChild(button("Fill all sections", () => void onFillAll(config)));

  const status = document.createElement("div");
  status.id = STATUS_ID;
  status.style.cssText = "margin-top:6px;color:#334;line-height:1.35";
  status.textContent = "Ready.";
  bar.appendChild(status);

  // The two fields this extension will not fill, said up front rather than left
  // as blanks a caseworker finds at DOL with the application open.
  const manual = document.createElement("div");
  manual.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px solid #eee;color:#663;";
  manual.textContent =
    "Type by hand: " +
    ETA9141_NOT_AUTOFILLED.map((f) => `${f.box} ${f.label}`).join(", ") +
    ". Both are unnamed dropdowns sitting next to FLAG's profile picker — " +
    "picking the wrong one would overwrite the whole section.";
  bar.appendChild(manual);

  document.body.appendChild(bar);
}

// ── actions ─────────────────────────────────────────────────────────────────

let running = false;

async function withLock(what: string, body: () => Promise<void>): Promise<void> {
  if (running) {
    setStatus(`Busy — ${what} ignored.`);
    return;
  }
  running = true;
  try {
    await body();
  } catch (err) {
    // Never let this escape: the click handlers fire these as `void`, so an
    // escaping rejection ends the run with nothing written to the log — the exact
    // failure mode that hid a CORS error on the myUSCIS side for a whole session.
    setStatus(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    dbg(`${what} threw: ${String(err)}`);
  } finally {
    running = false;
  }
}

function summarise(report: WalkReport): string {
  const refused = report.sections.flatMap((s) => s.fields).filter((f) => f.status === "refused");
  const unreached = report.sections.filter((s) => !s.reached).map((s) => s.title);
  const parts = [`${report.filled} filled`];
  if (report.failed) parts.push(`${report.failed} failed`);
  if (refused.length) parts.push(`${refused.length} refused`);
  if (unreached.length) parts.push(`${unreached.length} section(s) not reached`);
  if (report.unclaimed.length) parts.push(`${report.unclaimed.length} value(s) unclaimed`);
  return parts.join(", ") + ".";
}

async function onFillSection(config: FlagFormConfig): Promise<void> {
  await withLock("Fill section", async () => {
    resetDebugLog();
    const loaded = await loadValues(config);
    if (!loaded) return;
    const outcome = await fillCurrentSection(config, loaded.fieldValues);
    if (!outcome) {
      setStatus("This is not a section the ETA-9141 descriptor knows.");
      return;
    }
    const filled = outcome.fields.filter((f) => f.status === "filled").length;
    const failed = outcome.fields.filter((f) => f.status === "failed");
    setStatus(
      `${outcome.title}: ${filled} filled` +
        (failed.length ? `, ${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : "") +
        ". Press FLAG's own Continue to save.",
    );
  });
}

async function onFillAll(config: FlagFormConfig): Promise<void> {
  await withLock("Fill all", async () => {
    resetDebugLog();
    const loaded = await loadValues(config);
    if (!loaded) return;
    setStatus("Filling…");
    const report = await fillAll(config, loaded.fieldValues);
    setStatus(
      summarise(report) +
        " Nothing has been saved — press FLAG's own Continue on each section, and " +
        "check every value before you do.",
    );
    dbg(JSON.stringify(report, null, 1));
  });
}

// ── boot ────────────────────────────────────────────────────────────────────

function boot(): void {
  const config = currentConfig();
  if (!config) return;
  buildToolbar(config);
}

/**
 * Replace the toolbar with an instruction, once the extension has been reloaded
 * out from under this page.
 *
 * The toolbar has to GO, not just stop working. Leaving buttons on screen that
 * cannot do anything is what produced the first live failure on FLAG: the fill
 * was clicked, chrome.storage was gone, and the status line read "Cannot read
 * properties of undefined (reading 'local')" — which points at the storage
 * permission rather than at the page needing a refresh.
 */
function showReloadNotice(): void {
  document.getElementById(TOOLBAR_ID)?.remove();
  if (document.getElementById(STALE_ID)) return;
  const note = document.createElement("div");
  note.id = STALE_ID;
  note.setAttribute("role", "alert");
  note.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:280px;" +
    "background:#7c2d12;color:#fff;font:13px/1.4 system-ui,sans-serif;" +
    "padding:10px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);";
  note.textContent =
    "ParaLeagle autofill was updated. Reload this page (F5) to use the new " +
    "version — your FLAG draft is saved.";
  document.body.appendChild(note);
}

// FLAG is a single-page app: the application id in the path changes without a
// document load, so the toolbar has to be rebuilt on route change rather than
// only at document_idle.
let lastPath = window.location.pathname;
let routeTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (!contextAlive()) {
    // Stop polling FIRST. Without that the interval keeps firing and every tick
    // throws again, burying the one message that says what to do.
    if (routeTimer !== null) {
      clearInterval(routeTimer);
      routeTimer = null;
    }
    showReloadNotice();
    return;
  }
  if (window.location.pathname !== lastPath) {
    lastPath = window.location.pathname;
    document.getElementById(TOOLBAR_ID)?.remove();
    boot();
  }
}, 1000);

boot();
