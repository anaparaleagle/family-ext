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
import { DescriptorField, FormConfig, FormPage, RepeaterSpec, RevealSpec } from "./types";
import { detectCurrentPage } from "./section-detector";
import { uploadsInFlight } from "../engine/doc-uploader";

export interface PlannedField {
  spec: FieldSpec;
  value: string;
  /** Repeater row index (0 for non-repeaters), used to know when to click Add. */
  rowIndex: number;
  /** The descriptor marked this field `cond(...)` — it may legitimately be absent. */
  conditional?: boolean;
  /** Which field/value reveals it, when the descriptor declares that. */
  revealedBy?: RevealSpec;
  /**
   * True when some OTHER field on this page is revealed by this one, so the page
   * must wait for the revealed block to render after this is set.
   */
  reveals?: boolean;
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

/**
 * How many reveals deep a field sits: 0 when nothing reveals it, else one more
 * than its revealer. Following the chain is the point — on the reason-for-request
 * page, choosing "a change of status" reveals the change-to target, and setting
 * that target reveals the premium-processing radio. Depths 0, 1, 2, filled in
 * that order.
 *
 * A revealedBy pointing at a field that is not planned (no payload value) counts
 * as depth 1: it still sorts after everything unconditional, and the skip check
 * in fillPage is what decides not to attempt it.
 *
 * Defends against a cyclic or self-referential declaration by capping the walk —
 * a descriptor typo must not hang the fill.
 */
function revealDepth(p: PlannedField, byName: Map<string, PlannedField>): number {
  let depth = 0;
  let seen = p;
  const visited = new Set<string>([p.spec.name]);
  while (seen.revealedBy) {
    depth += 1;
    const parent = byName.get(seen.revealedBy.by);
    if (!parent || visited.has(parent.spec.name) || depth > 10) break;
    visited.add(parent.spec.name);
    seen = parent;
  }
  return depth;
}

/**
 * Sort so a field that REVEALS others is set before them, then radios (which may
 * reveal a block the descriptor has not pinned down), then country/state (search)
 * before other text (they drive cascading lookups), then the rest.
 *
 * Reveal depth outranks kind deliberately. "Radios first" was the old proxy for
 * "reveals first", and it is too coarse in both directions: the premium radio is
 * revealed BY a search field, so radios-first attempted it before the thing that
 * makes it exist, and it failed every run.
 */
function orderFields(planned: PlannedField[]): PlannedField[] {
  const rank = (p: PlannedField): number => {
    if (p.spec.kind === "radio") return 0;
    const n = p.spec.name.toLowerCase();
    if (n.includes("country")) return 1;
    if (n.includes("state") || n.includes("province")) return 2;
    return 3;
  };
  const byName = new Map(planned.map((p) => [p.spec.name, p]));
  const depth = new Map(planned.map((p) => [p.spec.name, revealDepth(p, byName)]));
  // Stable sort by (rowIndex, reveal depth, rank) so row 0 fully precedes row 1,
  // revealers precede what they reveal, and within one depth radios/country/state
  // still lead.
  return [...planned].sort(
    (a, b) =>
      a.rowIndex - b.rowIndex ||
      (depth.get(a.spec.name) ?? 0) - (depth.get(b.spec.name) ?? 0) ||
      rank(a) - rank(b),
  );
}

/**
 * True when the payload cannot satisfy this field's declared reveal, so myUSCIS
 * will never render it and there is nothing to attempt.
 *
 * Two ways to fail: the revealing field has no value at all (the question was
 * never answered), or it has one that is not a revealing answer (answering "no"
 * to the separate-petition question keeps the receipt-number block shut).
 */
function revealUnsatisfied(reveal: RevealSpec, fieldValues: Record<string, string>): boolean {
  const answer = fieldValues[reveal.by];
  if (answer === undefined || answer === "") return true;
  if (reveal.is === undefined) return false; // any non-blank answer reveals it
  const accepted = Array.isArray(reveal.is) ? reveal.is : [reveal.is];
  return !accepted.includes(answer);
}

/**
 * Build the ordered fill plan for a page from the descriptor + payload. Pure:
 * no DOM. For repeaters it expands {i} for each row the payload supplies.
 * A field with no payload value (or "" for non-checkboxes) is omitted.
 *
 * A conditional field whose declared reveal the payload cannot satisfy is omitted
 * too. It is NOT a failure and must not be reported as one: we hold a value for
 * it but no way to make USCIS show the input, so the honest plan is not to try.
 * That is how the principal-petition block used to read as "0/4 filled" —
 * four values, no answer to the question that opens the block.
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
    if (field.revealedBy && revealUnsatisfied(field.revealedBy, fieldValues)) {
      dbg(
        `fill: not attempting ${name} — nothing answered ` +
          `"${field.revealedBy.by}", so USCIS never shows this field`,
      );
      return;
    }
    out.push({
      spec: { name, kind: field.kind, optionValue: field.options ? value : undefined },
      value,
      rowIndex,
      conditional: field.conditional,
      revealedBy: field.revealedBy,
    });
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

  // Flag the fields that OTHERS depend on, so fillPage knows to wait for a block
  // to render after setting one instead of guessing with a fixed sleep.
  const revealers = new Set(out.map((p) => p.revealedBy?.by).filter(Boolean) as string[]);
  for (const p of out) if (revealers.has(p.spec.name)) p.reveals = true;

  return orderFields(out);
}

// ── DOM driving ────────────────────────────────────────────────────────────

export interface PageFillResult {
  slug: string;
  /** Fields actually attempted (excludes conditionals the page never revealed). */
  total: number;
  filled: number;
  failed: number;
  /**
   * Conditional fields that were not on the page — a legitimate non-reveal, not a
   * failure. Reported separately so a page reads as "12/12 filled (2 not shown)"
   * rather than "12/14", which looks broken.
   */
  skipped: number;
  results: SetResult[];
}

/** How long to wait for a revealed block to render after its answer is set. */
const REVEAL_RENDER_TIMEOUT_MS = 4000;

/**
 * The last two segments of a Formik name. The full names run to 90+ characters
 * and the meaning is always at the end, so an ordering or skip line stays
 * readable instead of wrapping five times.
 */
function shortName(name: string): string {
  return name.split(".").slice(-2).join(".");
}

/**
 * Wait for a field that should have just been revealed to appear in the DOM.
 * Returns true as soon as it does.
 *
 * This replaces a flat sleep for declared reveals: it returns the instant the
 * block renders (usually far quicker than the old 800ms) and still gives a slow
 * React commit real time. It is NOT a retry — a missing element after the full
 * window is reported as a failure, because a declared reveal that was driven and
 * still produced nothing is a genuine bug, not slowness.
 */
async function waitForRevealed(spec: FieldSpec, timeoutMs = REVEAL_RENDER_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (findByName(spec.name, spec.optionValue) !== null) return true;
    if (Date.now() >= deadline) return false;
    await sleep(150);
  }
}

/**
 * Fill the current page. For repeaters, clicks "Add" to render each row before
 * filling it. Fields that reveal other fields go first (see orderFields).
 * Returns a per-field result summary.
 */
export async function fillPage(
  page: FormPage,
  fieldValues: Record<string, string>,
): Promise<PageFillResult> {
  const plan = planPageFill(page, fieldValues);
  const results: SetResult[] = [];

  // What this page is about to do, and what it is NOT going to do. Both halves
  // matter when reading a run back: a field the backend never sent a value for
  // is invisible in the results, so it has to be named here or it looks filled.
  dbg(`fill: ${page.slug} — planning ${plan.length} of ${page.fields.length} descriptor field(s)`);
  if (plan.length) {
    dbg(`  order: ${plan.map((p) => shortName(p.spec.name)).join(" -> ")}`);
  }
  const unsent = page.fields
    .map((f) => f.name.replace(/\{i\}/g, "0"))
    .filter((n) => fieldValues[n] === undefined || fieldValues[n] === "");
  if (unsent.length) {
    dbg(`  no value from the backend for: ${unsent.map(shortName).join(", ")}`);
  }

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
  let skipped = 0;
  for (const p of plan) {
    if (lastWasRadio && p.spec.kind !== "radio") {
      // A radio may have revealed conditional fields; let React settle.
      await sleep(800);
    }

    if (p.revealedBy) {
      // Its reveal WAS driven (planPageFill dropped it otherwise), so wait for the
      // block to render rather than racing it. If it never renders, fall through
      // and let setValue report the failure — loudly. A driven reveal that shows
      // nothing is a broken descriptor or a changed form, and silence there is
      // exactly what let the premium radio and the address block sit unfilled.
      const appeared = await waitForRevealed(p.spec);
      if (!appeared) {
        dbg(
          `fill: ${p.spec.name} did not appear after setting "${p.revealedBy.by}" — ` +
            `the reveal is wrong or the form changed`,
        );
      }
    } else if (p.conditional && findByName(p.spec.name, p.spec.optionValue) === null) {
      // Conditional with NO declared reveal: all we can do is look. Absent means a
      // legitimate non-reveal (this branch hides the block), so skip it quietly
      // instead of counting a failure. Probed AFTER the radio-settle above so a
      // field a same-page radio just revealed is seen as present.
      skipped++;
      dbg(`fill: skip ${p.spec.name} — conditional field not shown on this page`);
      lastWasRadio = false;
      continue;
    }

    const res = await setValue(p.spec, p.value);
    results.push(res);
    if (!res.success) dbg(`fill: FAIL ${p.spec.name} — ${res.message}`);
    lastWasRadio = p.spec.kind === "radio" && res.success;

    // This answer opens a block below it. Give the block a chance to mount before
    // the next field is looked up — the wait ends as soon as it renders.
    if (p.reveals && res.success) {
      const revealed = plan.find((q) => q.revealedBy?.by === p.spec.name);
      if (revealed) await waitForRevealed(revealed.spec);
    }

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
    skipped,
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
/** How long to wait for the page's uploads to finish before watching Next.
 * Raised from 8s: we now wait on a REAL signal (myUSCIS swapping each row's
 * "Cancel" for "Remove") instead of guessing at spinner CSS classes, and a 10MB
 * scan genuinely takes longer than 8s to process server-side. Clicking Next early
 * is what raised USCIS's "your files have not finished uploading" modal on the
 * 2026-07-29 run. */
const UPLOAD_SETTLE_TIMEOUT_MS = 20000;
/** Selectors that signal an active upload/progress indicator in the page body. */
const UPLOAD_PROGRESS_SELECTOR =
  '[role="progressbar"], progress, [class*="progress" i], [class*="spinner" i], [class*="uploading" i]';
/** How long to wait for a recognized page's inputs to render before filling.
 * Fresh drafts mount their Formik inputs slowly, so give them room. */
const PAGE_READY_TIMEOUT_MS = 6000;

/**
 * Advance controls we must NEVER click autonomously, matched on their LABEL —
 * whatever a button's test-id says, its text decides. Draft only, always.
 *
 * This is a BACKSTOP, not the primary stop, and the 2026-07-15 I-539 review
 * capture proved why it cannot be the primary one: the control that advances
 * PAST the review page is a plain "Next" (id=button-button,
 * data-testid=next-button) — byte-identical to the Next on every other page.
 * No text guard can catch that without breaking the whole walk. What stops the
 * walk at review is the descriptor's `kind: "review"` page; this regex only
 * catches the pages DOWNSTREAM of review (pay-and-submit, e-sign, …) if we ever
 * got that far.
 */
const NEVER_CLICK_TEXT = /submit|pay\b|payment|e-?sign|sign\s+(and|&)|file\s+(and|&)|checkout/i;

/**
 * Path segment that means "you are at or past the review page". myUSCIS files
 * everything terminal under this one parent: the review page itself
 * (…/review-and-submit/review-your-application), then the applicant statement,
 * the signature pages and …/review-and-submit/pay-and-submit (route table read
 * live from the myUSCIS JS bundle 2026-07-15).
 */
const TERMINAL_PATH = /\/review-and-submit(\/|$)/i;

/** True when a control must never be clicked by the walk (Submit/Pay/e-sign). */
export function isForbiddenAdvanceControl(el: Element | null): boolean {
  if (!el) return false;
  return NEVER_CLICK_TEXT.test((el.textContent || "").trim());
}

/**
 * True when the URL is at (or past) the form's terminal review/sign/pay section.
 *
 * Belt-and-braces for the descriptor's `kind: "review"` stop. If the review page
 * is recognized, the walk stops on kind alone and never reaches this. This
 * covers the DRIFT case: USCIS renames the review slug, `detectCurrentPage`
 * returns null, and the walk's unknown-page branch would helpfully click "Next"
 * — straight through the statement and signature pages toward pay-and-submit.
 * Matching the stable PARENT path instead of one exact slug means a renamed leaf
 * still stops us. Structural, not literal-text — the same reason the text guard
 * can't do this job.
 */
export function onTerminalPath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  return TERMINAL_PATH.test(path);
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

/**
 * Wait for the page's Next to become clickable.
 *
 * Ticks every 10s while waiting. On an upload page this window is 60s, and it used
 * to pass in total silence — so a run that was patiently waiting for USCIS to
 * finish processing a 10MB scan was indistinguishable from a hung one. That is
 * precisely when someone clicks Fill all again and starts a second walk.
 */
async function waitForNextEnabled(timeoutMs = DEFAULT_NEXT_TIMEOUT_MS): Promise<HTMLButtonElement | null> {
  const start = Date.now();
  let lastTick = 0;
  while (Date.now() - start < timeoutMs) {
    const btn = findNextButton();
    if (btn && !btn.disabled) return btn;
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed >= 10 && elapsed - lastTick >= 10) {
      lastTick = elapsed;
      dbg(
        `fillAll: still waiting for Next to enable (${elapsed}s of ` +
          `${Math.round(timeoutMs / 1000)}s)${btn ? " — button present but disabled" : " — no button found yet"}`,
      );
    }
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
 * Wait for the page's uploads to actually finish before Next is considered.
 *
 * The authoritative signal is myUSCIS's OWN per-row control: a row still uploading
 * offers "Cancel" and becomes "Remove" when it completes. That is observable and
 * exact, unlike the spinner-class guess this used to rely on — which reported
 * "settled" while two files were mid-flight, so the walk clicked Next and USCIS
 * raised "Your files will not upload if you leave this page" (2026-07-29,
 * FAM-0100). The spinner check is kept as a secondary signal for pages that show
 * progress without a Cancel control.
 *
 * Never throws — an odd DOM simply resolves and the caller still gates on Next.
 */
async function waitForUploadToSettle(timeoutMs = UPLOAD_SETTLE_TIMEOUT_MS): Promise<void> {
  const start = Date.now();
  let announced = false;
  let lastTick = 0;
  while (Date.now() - start < timeoutMs) {
    const pending = uploadsInFlight();
    // Gate ONLY on the exact signal: myUSCIS's own per-row "Cancel", which it
    // swaps for "Remove" when an upload completes. The spinner-class guess is
    // reported for context but must NEVER hold the walk up — any element on the
    // page whose class merely CONTAINS "progress" (a step indicator, a completion
    // bar) would make this burn its whole window in silence on every upload page,
    // which is indistinguishable from a hang.
    const spinning = hasVisibleUploadProgress();
    if (pending === 0) {
      if (announced) dbg(`fillAll: uploads finished${spinning ? " (a progress element is still on the page, ignoring it)" : ""}`);
      return;
    }
    // Announce whichever signal we are waiting on, and tick every 5s. The first
    // version only spoke when it could see a Cancel control, so a wait driven by
    // the spinner signal looked like a hung run for up to 45 seconds — which is
    // when someone clicks Fill all again.
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (!announced || elapsed - lastTick >= 5) {
      announced = true;
      lastTick = elapsed;
      dbg(
        `fillAll: waiting for uploads to finish before Next — ` +
          `${pending} in flight${spinning ? ", progress indicator visible" : ""} (${elapsed}s)`,
      );
    }
    await sleep(400);
  }
  if (uploadsInFlight() > 0) {
    dbg(
      `fillAll: ${uploadsInFlight()} upload(s) still running after ` +
        `${Math.round(timeoutMs / 1000)}s — not clicking Next. Leaving the page now ` +
        `would cancel them. Wait for them to finish, then re-run.`,
    );
  }
}

/**
 * True when myUSCIS is showing its "your files have not finished uploading" modal.
 *
 * If this is up, the walk must STOP. Its "Leave this page" button aborts every
 * upload in progress, so clicking it would throw away the very documents we just
 * attached — never automate past this.
 */
function onUnfinishedUploadDialog(): boolean {
  const text = document.body?.innerText ?? "";
  return /files will not upload if you leave|have not finished uploading/i.test(text);
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
  const uploadsSeen: string[] = [];
  dbg(
    `fillAll: START ${config.formType} — descriptor has ${config.pages.length} pages, ` +
      `payload has ${Object.keys(fieldValues).length} field values`,
  );
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
    // Terminal-section stop, checked BEFORE page detection so it holds even when
    // the descriptor doesn't recognize the page (a renamed review slug must not
    // fall through to the unknown-page branch, which advances via Next).
    if (onTerminalPath(window.location.href)) {
      dbg("fillAll: reached the review/sign/pay section — stopping (never automate those)");
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
          // Belt-and-braces: the caller already guarantees this never throws,
          // but the walk must survive a bad upload page regardless. An escaping
          // rejection here ends the run as an unhandled rejection with NO stop
          // line in the log, which is indistinguishable from a truncated log —
          // the exact failure that hid the doc-upload CORS bug.
          try {
            uploadsSeen.push(page.slug);
            await onUploadPage(page);
          } catch (err) {
            dbg(
              `fillAll: No file attached to ${page.slug} — upload step errored ` +
                `(${err instanceof Error ? err.message : String(err)}); continuing`,
            );
          }
        } else {
          // Don't fill until the page's inputs have rendered, so a first-paint
          // race doesn't whiff every field with "element not on page".
          await waitForPageReady(page, fieldValues);
          const res = await fillPage(page, fieldValues);
          summaries.push(res);
          dbg(
            `fillAll: ${page.slug} — ${res.filled}/${res.total} filled` +
              (res.skipped ? ` (${res.skipped} conditional not shown)` : ""),
          );
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
      // If uploads are STILL running, do not touch Next. myUSCIS answers a
      // navigation attempt with "Your files will not upload if you leave this
      // page", whose only ways out are "Stay" or "Leave this page" — and Leave
      // aborts every upload in progress, throwing away the documents we just
      // attached. Stopping here keeps them uploading.
      if (uploadsInFlight() > 0) {
        dbg(
          `fillAll: ${uploadsInFlight()} upload(s) still in progress on ${page?.slug ?? "this page"} ` +
            `— stopping rather than risk cancelling them. Let them finish, then re-run.`,
        );
        break;
      }
      if (onUnfinishedUploadDialog()) {
        dbg(
          "fillAll: myUSCIS is asking whether to leave while files are still " +
            'uploading. Click "Stay on this page", let them finish, then re-run. ' +
            "(Never click \"Leave this page\" — it cancels the uploads.)",
        );
        break;
      }
      dbg(
        `fillAll: uploads settled on ${page?.slug ?? "this page"} — waiting for Next ` +
          `to enable (up to ${Math.round(UPLOAD_NEXT_TIMEOUT_MS / 1000)}s)`,
      );
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

  logRunSummary(config, summaries, uploadsSeen);
  return summaries;
}

/**
 * One block at the end of the run holding everything worth acting on, so a
 * pasted log can be read without scrolling back through 20 pages.
 *
 * Lists FAILURES with their page, because that is the only category that needs a
 * decision. Skips are counted but not enumerated — a skip is the walk working
 * correctly, and enumerating them buries the failures.
 */
function logRunSummary(
  config: FormConfig,
  summaries: PageFillResult[],
  uploadsSeen: string[],
): void {
  const filled = summaries.reduce((n, s) => n + s.filled, 0);
  const total = summaries.reduce((n, s) => n + s.total, 0);
  const skipped = summaries.reduce((n, s) => n + s.skipped, 0);
  dbg("──────────────────────────────────────────────");
  dbg(`fillAll: RUN SUMMARY (${config.formType})`);
  dbg(`  pages typed on: ${summaries.length}`);
  dbg(`  fields filled:  ${filled}/${total}`);
  dbg(`  not shown (conditional, correctly skipped): ${skipped}`);
  dbg(`  upload pages visited: ${uploadsSeen.length ? uploadsSeen.join(", ") : "none"}`);

  const failures: string[] = [];
  for (const s of summaries) {
    for (const r of s.results) {
      if (!r.success) failures.push(`${s.slug} -> ${shortName(r.name)} (${r.message})`);
    }
  }
  if (failures.length === 0) {
    dbg("  FAILURES: none");
  } else {
    dbg(`  FAILURES (${failures.length}) — these are the ones to look at:`);
    for (const f of failures) dbg(`    ${f}`);
  }

  const perPage = summaries
    .map((s) => `${s.slug} ${s.filled}/${s.total}${s.skipped ? ` +${s.skipped} not shown` : ""}`)
    .join("\n    ");
  dbg(`  per page:\n    ${perPage}`);
  dbg("──────────────────────────────────────────────");
}

/** Re-export for the toolbar's "Fill this section" action. */
export { findByName };
