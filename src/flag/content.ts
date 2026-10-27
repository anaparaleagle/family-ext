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
import { apiGet, apiPost } from "../runner/api-transport";
import { fillAll, fillCurrentSection, SectionOutcome, WalkReport } from "./fill-chain";
import { flushUnmappedFields } from "../engine/telemetry";
import { FLAG_CONFIGS } from "./registry";
import { FlagFormConfig } from "./types";
import { scrapeReviewFields } from "./review";

/** Storage keys for the FLAG side. Separate from the myUSCIS payload keys so a
 * loaded DOL form cannot be mistaken for a loaded I-130 or vice versa. */
const KEYS = {
  fieldValues: "flagFieldValues",
  formType: "flagFormType",
  caseId: "flagCaseId",
  accessToken: "accessToken",
  apiBaseUrl: "apiBaseUrl",
  // SOF-2191 — the FLAG values read back so far this review, accumulated
  // across every section visited (FLAG shows one section at a time).
  reviewValues: "lcaReviewValues",
} as const;

const DEFAULT_API_BASE_URL = "http://localhost:8001/api/v1";

function currentConfig(): FlagFormConfig | null {
  return FLAG_CONFIGS.find((c) => c.urlPattern.test(window.location.pathname)) ?? null;
}

// ── payload ─────────────────────────────────────────────────────────────────

interface Loaded {
  fieldValues: Record<string, string>;
  report: Record<string, unknown>;
  /** Case id (for health telemetry). Empty when loaded from cache without one. */
  caseId: string;
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
    return { fieldValues: cached, report: {}, caseId: (stored[KEYS.caseId] as string) ?? "" };
  }

  const caseId = stored[KEYS.caseId] as string | undefined;
  const accessToken = (stored[KEYS.accessToken] as string) ?? "";
  const apiBaseUrl = (stored[KEYS.apiBaseUrl] as string) ?? DEFAULT_API_BASE_URL;

  if (!caseId) {
    setStatus(`No case loaded — open the popup and pick a case for the ${config.formType}.`);
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
  return { fieldValues, report: res.data.autofill_report ?? {}, caseId };
}

// ── toolbar ─────────────────────────────────────────────────────────────────

const TOOLBAR_ID = "mk-flag-toolbar";
const STATUS_ID = "mk-flag-status";
const STALE_ID = "mk-flag-stale";
const REVIEW_PANEL_ID = "mk-flag-review-panel";

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
  // SOF-2191: the LCA summary sign-off only applies to the ETA-9035E — the
  // PERM forms this same toolbar drives have no equivalent review.
  if (config.formType === "ETA-9035E") {
    bar.appendChild(button("Review Summary", () => void onReviewSummary()));
  }

  const status = document.createElement("div");
  status.id = STATUS_ID;
  status.style.cssText = "margin-top:6px;color:#334;line-height:1.35";
  status.textContent = "Ready.";
  bar.appendChild(status);

  const reviewPanel = document.createElement("div");
  reviewPanel.id = REVIEW_PANEL_ID;
  bar.appendChild(reviewPanel);

  // The fields this extension will not fill, said up front rather than left
  // as blanks a caseworker finds at DOL with the application open.
  if (config.notAutofilled?.length) {
    const manual = document.createElement("div");
    manual.style.cssText =
      "margin-top:6px;padding-top:6px;border-top:1px solid #eee;color:#663;white-space:pre-line";
    manual.textContent =
      "Type by hand:\n" +
      config.notAutofilled.map((f) => `${f.box} ${f.label} — ${f.reason}`).join("\n");
    bar.appendChild(manual);
  }

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

/**
 * What the OES calculator and the worksite row did, in a caseworker's words.
 *
 * Said out loud rather than left in the log, because both are steps where the
 * run can do everything else right and still leave the section unfiled: a
 * calculator that did not open means no prevailing wage, and a row that was
 * not added means FLAG answers "Please enter in at least one row" however much
 * was typed above it.
 */
function sectionNotes(outcome: SectionOutcome): string {
  const notes: string[] = [];
  const modal = outcome.modal;
  if (modal && modal.status !== "skipped") {
    if (modal.status === "applied") {
      notes.push(`OES Wage Calculator: ${modal.result} — check it before you file.`);
    } else {
      notes.push(`OES Wage Calculator: ${modal.message ?? modal.status}`);
    }
  }
  const row = outcome.row;
  if (row) {
    if (row.status === "added") {
      notes.push(`Worksite added — the table now holds ${row.rows}.`);
    } else if (row.status === "disabled") {
      notes.push(
        "Could NOT add the worksite — FLAG has the Add button greyed out" +
          (row.errors.length ? `: ${row.errors.join("; ")}` : ". Read the errors on the page") +
          ". Nothing was saved for this worksite.",
      );
    } else if (row.status === "refused") {
      notes.push(
        `Pressed Add, but the table still reads ${row.rows}` +
          (row.errors.length ? ` — ${row.errors.join("; ")}` : "") +
          ". Add it yourself before pressing Continue.",
      );
    } else {
      notes.push("No 'Add Place of Employment' button found — add the worksite yourself.");
    }
  }
  return notes.join(" ");
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
      setStatus(`This is not a section the ${config.formType} descriptor knows.`);
      return;
    }
    void flushUnmappedFields(config.formType, loaded.caseId);
    const filled = outcome.fields.filter((f) => f.status === "filled").length;
    const failed = outcome.fields.filter((f) => f.status === "failed");
    const skipped = outcome.fields.filter((f) => f.status === "skipped");
    const notes = sectionNotes(outcome);
    setStatus(
      `${outcome.title}: ${filled} filled` +
        (failed.length ? `, ${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : "") +
        (skipped.length ? `, ${skipped.length} left for a reason (see the log)` : "") +
        ". Press FLAG's own Continue to save." +
        (notes ? ` ${notes}` : ""),
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
    void flushUnmappedFields(config.formType, loaded.caseId);
    const committed = report.sections.filter((s) => s.commit === "committed").length;
    const notes = report.sections.map(sectionNotes).filter(Boolean).join(" ");
    setStatus(
      summarise(report) +
        (notes ? ` ${notes}` : "") +
        ` ${committed} section(s) saved with FLAG's own Continue.` +
        (report.blockedAt
          ? ` STOPPED at "${report.blockedAt}" — FLAG would not accept it. Read the ` +
            "errors it is showing, fix them, and press Continue yourself; the " +
            "sections after it were not touched."
          : " Nothing was submitted — the walk never presses Submit, Sign or Certify. " +
            "Check every value before you file."),
    );
    dbg(JSON.stringify(report, null, 1));
  });
}

// ── LCA summary review (SOF-2191, porting the old portal's SOF-643) ────────

interface LcaDiscrepancy {
  field: string;
  label: string;
  questionnaire_value: string;
  flag_value: string;
}

interface ReviewContext {
  apiBaseUrl: string;
  caseId: string;
  accessToken: string;
}

async function reviewContext(): Promise<ReviewContext | null> {
  const stored = await chrome.storage.local.get([
    KEYS.caseId, KEYS.accessToken, KEYS.apiBaseUrl,
  ]);
  const caseId = stored[KEYS.caseId] as string | undefined;
  if (!caseId) return null;
  return {
    apiBaseUrl: (stored[KEYS.apiBaseUrl] as string) ?? DEFAULT_API_BASE_URL,
    caseId,
    accessToken: (stored[KEYS.accessToken] as string) ?? "",
  };
}

function renderReviewPanel(discrepancies: LcaDiscrepancy[], readCount: number): void {
  const panel = document.getElementById(REVIEW_PANEL_ID);
  if (!panel) return;
  panel.replaceChildren();
  panel.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px solid #eee";

  const summary = document.createElement("div");
  summary.style.cssText = `font-weight:600;margin-bottom:4px;color:${discrepancies.length ? "#7c2d12" : "#14532d"}`;
  summary.textContent = discrepancies.length
    ? `${discrepancies.length} difference(s) found (${readCount} field(s) read so far).`
    : `No differences in the ${readCount} field(s) read so far.`;
  panel.appendChild(summary);

  if (discrepancies.length) {
    const list = document.createElement("ul");
    list.style.cssText = "margin:4px 0 6px;padding-left:18px;color:#334";
    for (const d of discrepancies) {
      const li = document.createElement("li");
      li.textContent = `${d.label}: FLAG has "${d.flag_value}", the questionnaire has "${d.questionnaire_value}"`;
      list.appendChild(li);
    }
    panel.appendChild(list);
  }

  panel.appendChild(button("Sign Off", () => void onSignOff(discrepancies)));
}

/** "Review Summary" — read whatever LCA compare fields are on the current
 * FLAG page, merge with any already read on earlier pages, diff against the
 * questionnaire, and show the panel. Visit every section that carries a
 * compared box (B, C, F) before trusting a clean result. */
async function onReviewSummary(): Promise<void> {
  await withLock("Review Summary", async () => {
    const ctx = await reviewContext();
    if (!ctx) {
      setStatus(
        "Load a case's LCA data from the ParaLeagle extension popup first — " +
          "the review needs to know which case (and be signed in) to compare against.",
      );
      return;
    }

    const read = scrapeReviewFields();
    const stored = await chrome.storage.local.get(KEYS.reviewValues);
    const accumulated: Record<string, string> = {
      ...((stored[KEYS.reviewValues] as Record<string, string>) || {}),
      ...read,
    };
    await chrome.storage.local.set({ [KEYS.reviewValues]: accumulated });

    if (Object.keys(accumulated).length === 0) {
      setStatus(
        "Couldn't read any LCA values on this page. Open the section with the " +
          "job, employer, worksite or wage boxes and try again.",
      );
      return;
    }

    setStatus("Comparing against the questionnaire…");
    const resp = await apiPost<{ discrepancies: LcaDiscrepancy[] }>(
      `/cases/${encodeURIComponent(ctx.caseId)}/lca-summary/compare/`,
      { flag_values: accumulated },
      ctx,
    );
    if (!resp.ok || !resp.data) {
      setStatus(`Review failed: ${resp.error ?? "unknown error"}`);
      return;
    }
    const discrepancies = resp.data.discrepancies ?? [];
    setStatus(`Reviewed ${Object.keys(accumulated).length} field(s) read so far.`);
    renderReviewPanel(discrepancies, Object.keys(accumulated).length);
  });
}

async function onSignOff(discrepancies: LcaDiscrepancy[]): Promise<void> {
  const ctx = await reviewContext();
  if (!ctx) return;

  let overrideReason = "";
  if (discrepancies.length) {
    const entered = prompt(
      `There ${discrepancies.length === 1 ? "is" : "are"} still ${discrepancies.length} ` +
        "unresolved difference(s). To sign off anyway, enter a reason (recorded on the case):",
    );
    if (entered === null) return; // cancelled
    if (!entered.trim()) {
      alert("An override reason is required to sign off with unresolved differences.");
      return;
    }
    overrideReason = entered.trim();
  }

  const resp = await apiPost(
    `/cases/${encodeURIComponent(ctx.caseId)}/lca-summary/sign-off/`,
    { override_reason: overrideReason },
    ctx,
  );
  if (!resp.ok) {
    setStatus(`Sign-off failed: ${resp.error ?? "unknown error"}`);
    return;
  }
  document.getElementById(REVIEW_PANEL_ID)?.replaceChildren();
  setStatus("LCA summary signed off. The in-process LCA upload is now unlocked.");
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
