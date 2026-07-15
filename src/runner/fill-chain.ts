// The guided-online-form page-walk. Two layers:
//   - PURE planning (planPageFill, repeaterRowCount, orderFields) — no DOM, no
//     async, fully unit-tested.
//   - DOM driving (fillPage, fillAll, navigation) — uses the engine value-setter,
//     clicks repeater Add buttons, walks via the form's own Next button.
//
// The chain is form-agnostic AND data-agnostic: it takes the descriptor pages
// (via FormConfig) as a parameter and fills a page's fields by matching their
// `[name]` against the backend payload. Names absent from the payload are
// skipped. Radios are filled first (they can reveal conditional fields). For
// repeater pages, it counts how many indexed rows the payload supplies, clicks
// "Add" to render each, then fills the indexed names.

import { setValue, findByName } from "../engine/value-setter";
import { FieldSpec, SetResult } from "../engine/types";
import { dbg } from "../engine/logger";
import { DescriptorField, FormConfig, FormPage, RepeaterSpec } from "./types";
import { detectCurrentPage } from "./section-detector";

export interface PlannedField {
  spec: FieldSpec;
  value: string;
  /** Repeater row index (0 for non-repeaters), used to know when to click Add. */
  rowIndex: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── PURE planning ──────────────────────────────────────────────────────────

/** How many indexed rows the payload supplies for a repeater, by probing the
 * row-0 anchor field name then 1, 2, … until a row has no payload keys. */
export function repeaterRowCount(
  _repeater: RepeaterSpec,
  templateFields: DescriptorField[],
  fieldValues: Record<string, string>,
): number {
  let count = 0;
  for (let i = 0; i < 50; i++) {
    const rowHasData = templateFields.some((f) => {
      const name = f.name.replace(/\{i\}/g, String(i));
      const v = fieldValues[name];
      return v !== undefined && v !== "";
    });
    if (!rowHasData) break;
    count = i + 1;
  }
  return count;
}

/** Sort: radios first (may reveal conditional fields), then country/state
 * (search) before other text (they drive cascading lookups), then the rest. */
function orderFields(planned: PlannedField[]): PlannedField[] {
  const rank = (p: PlannedField): number => {
    if (p.spec.kind === "radio") return 0;
    const n = p.spec.name.toLowerCase();
    if (n.includes("country")) return 1;
    if (n.includes("state") || n.includes("province")) return 2;
    return 3;
  };
  // Stable sort by (rowIndex, rank) so row 0 fully precedes row 1, and within a
  // row radios/country/state lead.
  return [...planned].sort((a, b) => a.rowIndex - b.rowIndex || rank(a) - rank(b));
}

/**
 * Build the ordered fill plan for a page from the descriptor + payload. Pure:
 * no DOM. For repeaters it expands {i} for each row the payload supplies.
 * A field with no payload value (or "" for non-checkboxes) is omitted.
 */
export function planPageFill(
  page: FormPage,
  fieldValues: Record<string, string>,
): PlannedField[] {
  const out: PlannedField[] = [];

  const collect = (field: DescriptorField, rowIndex: number): void => {
    const name = field.name.replace(/\{i\}/g, String(rowIndex));
    const value = fieldValues[name];
    if (value === undefined) return;
    // Empty string fills nothing except a checkbox (where "" => leave unchecked,
    // which is the default — so we skip it too; checkboxes only act when truthy).
    if (value === "") return;
    out.push({ spec: { name, kind: field.kind, optionValue: field.options ? value : undefined }, value, rowIndex });
  };

  if (page.repeater) {
    // A page may MIX single-instance fields (no {i}) with a repeater sub-list —
    // e.g. /about-you/your-name carries the primary name plus an "other names
    // used" repeater. Fill the plain fields once (row 0 semantics); expand only
    // the {i} fields per row. Counting rows from the {i} fields alone keeps a
    // non-repeater field (which matches every index) from inflating the count.
    // For a pure repeater page plainFields is empty, so behaviour is unchanged.
    const repeaterFields = page.fields.filter((f) => f.name.includes("{i}"));
    for (const field of page.fields) {
      if (!field.name.includes("{i}")) collect(field, 0);
    }
    const rows = repeaterRowCount(page.repeater, repeaterFields, fieldValues);
    for (let i = 0; i < rows; i++) {
      for (const field of repeaterFields) collect(field, i);
    }
  } else {
    for (const field of page.fields) collect(field, 0);
  }

  return orderFields(out);
}

// ── DOM driving ────────────────────────────────────────────────────────────

export interface PageFillResult {
  slug: string;
  total: number;
  filled: number;
  failed: number;
  results: SetResult[];
}

/**
 * Fill the current page. For repeaters, clicks "Add" to render each row before
 * filling it. Radios fill first. Returns a per-field result summary.
 */
export async function fillPage(
  page: FormPage,
  fieldValues: Record<string, string>,
): Promise<PageFillResult> {
  const plan = planPageFill(page, fieldValues);
  const results: SetResult[] = [];

  if (page.repeater) {
    // Render each repeater row before filling it. Count rows from the {i} fields
    // only (so single-instance fields on a mixed page don't inflate the count).
    // Row 0 usually renders after one Add click; the dump shows repeaters render
    // no inputs until Add (on a mixed page row 0 may already be present).
    const repeaterFields = page.fields.filter((f) => f.name.includes("{i}"));
    const rows = repeaterRowCount(page.repeater, repeaterFields, fieldValues);
    for (let i = 0; i < rows; i++) {
      await ensureRepeaterRow(page.repeater, i);
    }
  }

  let lastWasRadio = false;
  for (const p of plan) {
    if (lastWasRadio && p.spec.kind !== "radio") {
      // A radio may have revealed conditional fields; let React settle.
      await sleep(800);
    }
    const res = await setValue(p.spec, p.value);
    results.push(res);
    if (!res.success) dbg(`fill: FAIL ${p.spec.name} — ${res.message}`);
    lastWasRadio = p.spec.kind === "radio" && res.success;

    // After country/state autocomplete, wait for dependent lookups.
    const n = p.spec.name.toLowerCase();
    if ((n.includes("country") || n.includes("state")) && p.spec.kind === "search" && res.success) {
      await sleep(1200);
    }
  }

  const filled = results.filter((r) => r.success).length;
  return {
    slug: page.slug,
    total: results.length,
    filled,
    failed: results.length - filled,
    results,
  };
}

/** Click the repeater "Add" button until the row at `index` is rendered. */
async function ensureRepeaterRow(repeater: RepeaterSpec, index: number): Promise<void> {
  const anchorName = `${repeater.namePrefix}.${index}.`;
  if (rowRendered(anchorName)) return;
  const btn = findAddButton(repeater.addButtonText);
  if (!btn) {
    dbg(`fill: no "Add" button (${repeater.addButtonText}) to render row ${index}`);
    return;
  }
  btn.click();
  for (let attempt = 0; attempt < 20 && !rowRendered(anchorName); attempt++) {
    await sleep(150);
  }
}

function rowRendered(anchorPrefix: string): boolean {
  // Any input whose name starts with the row's anchor prefix means the row
  // exists. We can't use findByName (exact) — probe with a prefix scan.
  const inputs = document.querySelectorAll<HTMLElement>("input, select, textarea");
  for (const el of Array.from(inputs)) {
    const name = el.getAttribute("name");
    if (name && name.startsWith(anchorPrefix)) return true;
  }
  return false;
}

function findAddButton(text: string): HTMLElement | null {
  const want = text.toLowerCase().trim();
  // Skip the global myUSCIS nav/sidebar — its "Change your client's address"
  // link contains "add" (inside "address") and must never be taken for an "Add" row button.
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], a'),
  ).filter((b) => !b.closest('nav, aside, header, [role="navigation"]'));
  // 1. A control whose label contains the specific add-phrase AND "add" as a
  //    WHOLE WORD (so "add" never matches the "add" inside "address").
  for (const b of candidates) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (t.includes(want) && /\badd\b/.test(t)) return b;
  }
  // 2. Generic "Add…" control: starts with the word "add" ("Add", "Add another"),
  //    but not "Additional…" and never a stray "…address" link.
  for (const b of candidates) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (/^add\b/.test(t)) return b;
  }
  return null;
}

// ── Navigation ──────────────────────────────────────────────────────────────

/** Default window to wait for Next to become enabled before clicking. */
const DEFAULT_NEXT_TIMEOUT_MS = 12000;
/** After clicking a repeater "Save Entry" commit button, how long to wait for
 * the row to commit and a Next/Continue to appear + enable. */
const SAVE_COMMIT_TIMEOUT_MS = 8000;
/** Upload pages keep Next DISABLED while the just-attached file finishes
 * uploading server-side (processing runs a few seconds past the point the
 * doc-uploader reports "attached"); give Next much longer to enable. */
const UPLOAD_NEXT_TIMEOUT_MS = 60000;
/** Best-effort: how long to wait for an in-progress upload spinner to clear
 * before we even start watching Next. The robust signal is Next enabling. */
const UPLOAD_SETTLE_TIMEOUT_MS = 8000;
/** Selectors that signal an active upload/progress indicator in the page body. */
const UPLOAD_PROGRESS_SELECTOR =
  '[role="progressbar"], progress, [class*="progress" i], [class*="spinner" i], [class*="uploading" i]';
/** How long to wait for a recognized page's inputs to render before filling.
 * Fresh drafts mount their Formik inputs slowly, so give them room. */
const PAGE_READY_TIMEOUT_MS = 6000;

/**
 * Advance controls we must NEVER click autonomously. The walk stops before the
 * review page of a form whose review slug is in the descriptor, but a form
 * whose review page has NOT been captured (the I-539's has not) would otherwise
 * be treated as an unrecognized page and advanced past — straight into
 * Submit/Pay/e-sign. This is the backstop that makes that impossible: whatever
 * a button's test-id says, its LABEL decides. Draft only, always.
 */
const NEVER_CLICK_TEXT = /submit|pay\b|payment|e-?sign|sign\s+(and|&)|file\s+(and|&)|checkout/i;

/** True when a control must never be clicked by the walk (Submit/Pay/e-sign). */
export function isForbiddenAdvanceControl(el: Element | null): boolean {
  if (!el) return false;
  return NEVER_CLICK_TEXT.test((el.textContent || "").trim());
}

/**
 * Find the form's Next/Continue button (same selectors myUSCIS uses). Never
 * returns a Submit/Pay/e-sign control, whatever its test-id or id says.
 */
export function findNextButton(doc: Document = document): HTMLButtonElement | null {
  const byTestId = doc.querySelector<HTMLButtonElement>('button[data-testid="next-button"]');
  if (byTestId && !isForbiddenAdvanceControl(byTestId)) return byTestId;
  const byId = doc.querySelector<HTMLButtonElement>("button#button-button");
  if (byId && /next|continue/i.test(byId.textContent || "") && !isForbiddenAdvanceControl(byId)) {
    return byId;
  }
  for (const b of Array.from(doc.querySelectorAll<HTMLButtonElement>("button"))) {
    if (/^(next|continue)$/i.test((b.textContent || "").trim())) return b;
  }
  return null;
}

/**
 * Find a repeater "Save Entry" / "Save and continue" COMMIT button in the form
 * body. On myUSCIS repeater pages (e.g. /other-information/other-petitions) the
 * just-entered row must be committed with this button before any Next/Continue
 * appears. Matches the explicit commit phrases, or a bare "save" that is NOT a
 * leave-the-form action ("save and exit", "save draft", "save for later"). The
 * global nav/sidebar/header (which carries the form-wide "Save and exit") is
 * excluded so we never click out of the form.
 */
export function findSaveButton(doc: Document = document): HTMLElement | null {
  // "Save and exit/close", "Save draft", "Save for later" all LEAVE the form.
  const LEAVE = /save\s+(and|&)\s+(exit|close)|save\s+draft|save\s+for\s+later/;
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).filter((b) => !b.closest('nav, aside, header, [role="navigation"]'));
  // 1. Explicit commit phrases: "Save Entry", "Save and continue", "Save & continue".
  for (const b of candidates) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (/save\s+entry/.test(t) || /save\s+(and|&)\s+continue/.test(t)) return b;
  }
  // 2. A bare "save" that isn't a leave-the-form action.
  for (const b of candidates) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (/\bsave\b/.test(t) && !LEAVE.test(t)) return b;
  }
  return null;
}

async function waitForNextEnabled(timeoutMs = DEFAULT_NEXT_TIMEOUT_MS): Promise<HTMLButtonElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = findNextButton();
    if (btn && !btn.disabled) return btn;
    await sleep(300);
  }
  return findNextButton();
}

async function waitForPageChange(prevUrl: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(300);
    if (window.location.href !== prevUrl) return true;
  }
  return false;
}

/**
 * Wait until a recognized page's inputs have actually rendered, so a first-paint
 * race (the page hasn't mounted when Fill All clicks) doesn't make every field
 * whiff with "element not on page" and record the page 0/N.
 *
 * Resolves as soon as ANY field the payload supplies for this page is present in
 * the DOM. For a repeater page (whose indexed rows don't exist until "Add" is
 * clicked) the repeater's Add button counts as "rendered". Returns immediately
 * when the page has nothing to fill (an empty plan is a legitimate 0/0 page, not
 * a race — we must not stall there), and on the common case where the page is
 * already rendered (the first probe passes, so no delay is added).
 */
export async function waitForPageReady(
  page: FormPage,
  fieldValues: Record<string, string>,
  timeoutMs = PAGE_READY_TIMEOUT_MS,
): Promise<void> {
  const plan = planPageFill(page, fieldValues);
  if (plan.length === 0) return; // nothing to fill -> nothing to wait for
  // Plain (non-repeater-row) fields this page will fill. For a MIXED page (e.g.
  // /about-you/your-name = a primary name + an "other names" repeater) the page
  // is only truly "up" once a plain Formik input renders — the repeater's Add
  // button can appear BEFORE the inputs do, which would otherwise make us fill
  // too early and whiff every field with "element not on page".
  const plainNames = (page.repeater
    ? page.fields.filter((f) => !f.name.includes("{i}"))
    : page.fields
  )
    .map((f) => f.name)
    .filter((n) => fieldValues[n] !== undefined && fieldValues[n] !== "");
  const ready = (): boolean => {
    if (plainNames.length > 0) {
      return plainNames.some((n) => findByName(n) !== null);
    }
    // Pure repeater page: rows render only after Add, so its presence = page up.
    if (page.repeater && findAddButton(page.repeater.addButtonText)) return true;
    return plan.some((p) => findByName(p.spec.name, p.spec.optionValue) !== null);
  };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (ready()) return;
    await sleep(200);
  }
}

/**
 * Best-effort wait for an in-progress upload UI to disappear after a batch is
 * attached. The authoritative signal that an upload finished is Next becoming
 * enabled (the caller watches that next); this just avoids clicking before the
 * spinner clears. Never throws — a bad selector or odd DOM simply resolves.
 */
async function waitForUploadToSettle(timeoutMs = UPLOAD_SETTLE_TIMEOUT_MS): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!hasVisibleUploadProgress()) return;
    await sleep(400);
  }
}

function hasVisibleUploadProgress(): boolean {
  try {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(UPLOAD_PROGRESS_SELECTOR))) {
      // Ignore the form's persistent step/section progress in the nav/sidebar —
      // we only care about an active upload spinner in the page body.
      if (el.closest('nav, aside, header, [role="navigation"]')) continue;
      if (isElementVisible(el)) return true;
    }
  } catch {
    // Selector unsupported in this engine — treat as "nothing in progress".
  }
  return false;
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(el) : null;
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

/**
 * True when the page we're on is a myUSCIS sign-in / session-expired screen
 * rather than a form page. myUSCIS bounces an expired session to the account
 * login, and the walk must stop there with a clear message instead of clicking
 * "Next"-ish controls through account screens.
 */
export function onLoginPage(doc: Document = document): boolean {
  const path = (doc.location?.pathname ?? "").toLowerCase();
  if (/\/(sign-?in|log-?in|session|account\/login)/.test(path)) return true;
  // A password field outside the form host is the unambiguous DOM signal.
  return doc.querySelector('input[type="password"]') !== null;
}

/**
 * Fill-All: from the current page, fill it, click Next, wait, repeat — walking
 * the descriptor order for the given form. NEVER URL-hops (respects the
 * anti-deep-linking guard); NEVER advances past the review page and NEVER
 * clicks Submit/Pay/e-sign. Upload pages are filled by the doc-flow (caller
 * wires that) — here we only TYPE.
 */
export async function fillAll(
  config: FormConfig,
  fieldValues: Record<string, string>,
  onUploadPage: (page: FormPage) => Promise<void>,
): Promise<PageFillResult[]> {
  const summaries: PageFillResult[] = [];
  const visited = new Set<string>();
  const maxSteps = config.pages.length + 10; // safety cap (room to skip unknown pages)
  let consecutiveUnknown = 0;
  const MAX_CONSECUTIVE_UNKNOWN = 4; // bail if we've clearly walked off the form

  for (let step = 0; step < maxSteps; step++) {
    if (onLoginPage()) {
      dbg(
        "fillAll: myUSCIS is showing a sign-in page — your USCIS session expired. " +
          "Sign in again, reopen the draft, then run Fill all.",
      );
      break;
    }
    const page = detectCurrentPage(config.pages);
    let isUploadPage = false;
    if (!page) {
      // Page not in the descriptor — e.g. a preparer detail sub-page, or an
      // uncaptured conditional. Don't stop the whole run; skip past it via Next.
      // Bail only if several unknown pages stack up, which means we've left the
      // form entirely.
      if (++consecutiveUnknown > MAX_CONSECUTIVE_UNKNOWN) {
        dbg(
          `fillAll: ${MAX_CONSECUTIVE_UNKNOWN} unrecognized pages in a row — ` +
            `left the ${config.formType} form, stopping`,
        );
        break;
      }
      dbg(`fillAll: page not in descriptor (${window.location.pathname}) — skipping past it`);
    } else {
      consecutiveUnknown = 0;
      if (page.kind === "review") {
        dbg("fillAll: reached Review — stopping before Submit/Pay (never automate those)");
        break;
      }
      isUploadPage = page.kind === "upload";
      if (visited.has(page.slug)) {
        dbg(`fillAll: already visited ${page.slug}, advancing without refilling`);
      } else {
        visited.add(page.slug);
        if (page.kind === "upload") {
          await onUploadPage(page);
        } else {
          // Don't fill until the page's inputs have rendered, so a first-paint
          // race doesn't whiff every field with "element not on page".
          await waitForPageReady(page, fieldValues);
          const res = await fillPage(page, fieldValues);
          summaries.push(res);
          dbg(`fillAll: ${page.slug} — ${res.filled}/${res.total} filled`);
        }
      }
    }

    const prevUrl = window.location.href;

    if (isUploadPage) {
      // After an upload, Next stays DISABLED until the file finishes uploading
      // server-side. Let any spinner clear, then give Next a much longer window
      // to enable before clicking. The robust signal is Next becoming enabled —
      // if it never does, stop rather than click a dead button forever.
      await waitForUploadToSettle();
      const next = await waitForNextEnabled(UPLOAD_NEXT_TIMEOUT_MS);
      if (!next || next.disabled) {
        dbg(
          "fillAll: Next never enabled on this upload page — either no file was " +
            "attached (a required upload with nothing resolved) or the upload is " +
            "still processing. Stopping; attach the file by hand and re-run.",
        );
        break;
      }
      next.click();
    } else {
      let next = await waitForNextEnabled();
      if (!next) {
        // Repeater pages (e.g. /other-information/other-petitions) expose NO
        // Next/Continue until the just-entered row is COMMITTED via a "Save
        // Entry" button; clicking it surfaces the page's Next. Try that
        // save-then-next sequence before giving up.
        const saveBtn = findSaveButton();
        if (!saveBtn) {
          dbg("fillAll: no Next button, stopping");
          break;
        }
        dbg('fillAll: no Next — clicking "Save Entry" to commit the row, then advancing');
        saveBtn.click();
        next = await waitForNextEnabled(SAVE_COMMIT_TIMEOUT_MS);
        if (!next) {
          if (window.location.href !== prevUrl) {
            // Saving committed and advanced directly (no separate Next). Fall
            // through to the shared page-change check, which will see the URL
            // change and let the loop re-detect the new page.
            dbg("fillAll: Save Entry committed and advanced the page");
          } else {
            dbg("fillAll: Save Entry clicked but no Next appeared and URL unchanged — stopping");
            break;
          }
        }
      }
      if (next) next.click();
    }

    if (!(await waitForPageChange(prevUrl))) {
      dbg("fillAll: page did not change after Next, stopping");
      break;
    }
    // Safety net: the walk must NEVER leave this form. If a stray Next/link
    // click landed us on a myUSCIS account page (e.g. change-of-address), stop
    // immediately rather than keep walking through account screens.
    if (!window.location.pathname.includes(config.hostPath)) {
      dbg(
        `fillAll: navigation left the ${config.formType} form ` +
          `(${window.location.pathname}) — stopping`,
      );
      break;
    }
    await sleep(600); // let the new page settle before re-detecting
  }

  return summaries;
}

/** Re-export for the toolbar's "Fill this section" action. */
export { findByName };
