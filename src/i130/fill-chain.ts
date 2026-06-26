// The I-130 page-walk. Two layers:
//   - PURE planning (planPageFill, repeaterRowCount, orderFields) — no DOM, no
//     async, fully unit-tested.
//   - DOM driving (fillPage, fillAll, navigation) — uses the engine value-setter,
//     clicks repeater Add buttons, walks via the form's own Next button.
//
// The chain is data-agnostic: it fills a page's descriptor fields by matching
// their `[name]` against the backend payload. Names absent from the payload are
// skipped. Radios are filled first (they can reveal conditional fields). For
// repeater pages, it counts how many indexed rows the payload supplies, clicks
// "Add" to render each, then fills the indexed names.

import { setValue, findByName } from "../engine/value-setter";
import { FieldSpec, SetResult } from "../engine/types";
import { dbg } from "../engine/logger";
import { DescriptorField, FormPage, I130_PAGES, RepeaterSpec } from "./form-descriptor";
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
    const rows = repeaterRowCount(page.repeater, page.fields, fieldValues);
    for (let i = 0; i < rows; i++) {
      for (const field of page.fields) collect(field, i);
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
    const maxRow = plan.reduce((m, p) => Math.max(m, p.rowIndex), -1);
    // Ensure each needed row is rendered before filling (row 0 usually renders
    // after one Add click; the dump shows repeaters render no inputs until Add).
    for (let i = 0; i <= maxRow; i++) {
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
  const want = text.toLowerCase();
  const buttons = document.querySelectorAll<HTMLElement>('button, [role="button"], a');
  for (const b of Array.from(buttons)) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (t.includes(want) || t.startsWith("add")) return b;
  }
  return null;
}

// ── Navigation ──────────────────────────────────────────────────────────────

/** Find the form's Next/Continue button (same selectors myUSCIS uses). */
export function findNextButton(doc: Document = document): HTMLButtonElement | null {
  const byTestId = doc.querySelector<HTMLButtonElement>('button[data-testid="next-button"]');
  if (byTestId) return byTestId;
  const byId = doc.querySelector<HTMLButtonElement>("button#button-button");
  if (byId && /next|continue/i.test(byId.textContent || "")) return byId;
  for (const b of Array.from(doc.querySelectorAll<HTMLButtonElement>("button"))) {
    if (/^(next|continue)$/i.test((b.textContent || "").trim())) return b;
  }
  return null;
}

async function waitForNextEnabled(timeoutMs = 12000): Promise<HTMLButtonElement | null> {
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
 * Fill-All: from the current page, fill it, click Next, wait, repeat — walking
 * the descriptor order. NEVER URL-hops (respects the anti-deep-linking guard);
 * NEVER advances past the review page (so it can't reach Submit/Pay). Upload
 * pages are filled by the doc-flow (caller wires that) — here we only TYPE.
 */
export async function fillAll(
  fieldValues: Record<string, string>,
  onUploadPage: (page: FormPage) => Promise<void>,
): Promise<PageFillResult[]> {
  const summaries: PageFillResult[] = [];
  const visited = new Set<string>();
  const maxSteps = I130_PAGES.length + 5; // safety cap

  for (let step = 0; step < maxSteps; step++) {
    const page = detectCurrentPage();
    if (!page) {
      dbg("fillAll: current page not recognized as an I-130 page, stopping");
      break;
    }
    if (page.kind === "review") {
      dbg("fillAll: reached Review — stopping before Submit/Pay (never automate those)");
      break;
    }
    if (visited.has(page.slug)) {
      dbg(`fillAll: already visited ${page.slug}, advancing without refilling`);
    } else {
      visited.add(page.slug);
      if (page.kind === "upload") {
        await onUploadPage(page);
      } else {
        const res = await fillPage(page, fieldValues);
        summaries.push(res);
        dbg(`fillAll: ${page.slug} — ${res.filled}/${res.total} filled`);
      }
    }

    const prevUrl = window.location.href;
    const next = await waitForNextEnabled();
    if (!next) {
      dbg("fillAll: no Next button, stopping");
      break;
    }
    next.click();
    if (!(await waitForPageChange(prevUrl))) {
      dbg("fillAll: page did not change after Next, stopping");
      break;
    }
    await sleep(600); // let the new page settle before re-detecting
  }

  return summaries;
}

/** Re-export for the toolbar's "Fill this section" action. */
export { findByName };
