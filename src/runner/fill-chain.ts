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

import { setValue, findByName, locateElement } from "../engine/value-setter";
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
  /**
   * This field is a repeater's VARIANT DISCRIMINATOR — the answer that decides
   * which row shape renders. Nothing else in the row exists until it is set, so
   * it outranks every other ordering rule.
   */
  isDiscriminator?: boolean;
  /**
   * A single-instance field sharing a page with a repeater.
   *
   * Ordering, not bookkeeping: clicking a repeater Add COVERS the plain inputs, so
   * a plain field filled after a row is unreachable. A live run reported exactly
   * that — "FAIL yourFamily.children.totalNumberOfChildren - element not on page".
   */
  plain?: boolean;
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
    // A variant discriminator decides whether the rest of the row EXISTS, so it
    // leads unconditionally. It is a `search` field on the N-400, which would
    // otherwise rank last and be driven after the inputs it creates — the same
    // shape of mistake as attempting the premium radio before its revealer.
    if (p.isDiscriminator) return -1;
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
      // Plain single-instance fields lead — a repeater Add hides them.
      Number(!!b.plain) - Number(!!a.plain) ||
      a.rowIndex - b.rowIndex ||
      (depth.get(a.spec.name) ?? 0) - (depth.get(b.spec.name) ?? 0) ||
      rank(a) - rank(b),
  );
}

/**
 * Upper bound on items in a NESTED list (a repeater inside a repeater row).
 * Matches the 50-row cap on outer rows: a backstop against a malformed payload
 * spinning forever, not a real limit anyone should hit.
 */
const MAX_NESTED_ITEMS = 50;

/**
 * The part of a repeater field name AFTER the row index — e.g.
 * "employmentInfo.workName" from "applicant.schoolsAndEmployment.{i}.employmentInfo.workName".
 * This is the key a `variants` shape list is written in, so shapes stay readable
 * instead of repeating the full 60-character prefix on every entry.
 */
function rowFieldSuffix(templateName: string): string {
  const parts = templateName.split("{i}.");
  return parts.length > 1 ? parts[1] : templateName;
}

/**
 * The field suffixes that actually render for one row of a polymorphic repeater,
 * or null when every field should be planned.
 *
 * Null (plan everything) is deliberate for both unknown cases — no discriminator
 * value, and a discriminator value we have no shape for. USCIS can rename an
 * option, and dropping the row silently would be the worst outcome: the fields are
 * declared `cond(...)`, so ones that turn out not to exist skip quietly rather
 * than failing. Guessing is worse than deferring to the DOM here.
 */
function activeRowShape(
  repeater: RepeaterSpec,
  rowIndex: number,
  fieldValues: Record<string, string>,
): string[] | null {
  const variants = repeater.variants;
  if (!variants) return null;
  const chosen = fieldValues[variants.discriminator.replace(/\{i\}/g, String(rowIndex))];
  if (chosen === undefined || chosen === "") return null;
  const shape = variants.shapes[chosen];
  if (!shape) {
    dbg(
      `fill: row ${rowIndex} type "${chosen}" is not a known shape — ` +
        `planning every field and letting the page decide`,
    );
    return null;
  }
  return shape;
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

  const collect = (
    field: DescriptorField,
    rowIndex: number,
    opts: { nestedIndex?: number; isDiscriminator?: boolean; plain?: boolean } = {},
  ): void => {
    let name = field.name.replace(/\{i\}/g, String(rowIndex));
    if (opts.nestedIndex !== undefined) name = name.replace(/\{j\}/g, String(opts.nestedIndex));
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
      spec: {
        name,
        kind: field.kind,
        optionValue: field.options ? value : undefined,
        ...(field.locate ? { locate: field.locate } : {}),
      },
      value,
      rowIndex,
      conditional: field.conditional,
      revealedBy: field.revealedBy,
      ...(opts.isDiscriminator ? { isDiscriminator: true } : {}),
      ...(opts.plain ? { plain: true } : {}),
    });
  };

  if (page.repeater) {
    // A page may MIX single-instance fields (no {i}) with a repeater sub-list —
    // e.g. /about-you/your-name carries the primary name plus an "other names
    // used" repeater. Fill the plain fields once (row 0 semantics); expand only
    // the {i} fields per row. Counting rows from the {i} fields alone keeps a
    // non-repeater field (which matches every index) from inflating the count.
    // For a pure repeater page plainFields is empty, so behaviour is unchanged.
    const repeater = page.repeater;
    const repeaterFields = page.fields.filter((f) => f.name.includes("{i}"));
    for (const field of page.fields) {
      if (!field.name.includes("{i}")) collect(field, 0, { plain: true });
    }
    const rows = repeaterRowCount(repeater, repeaterFields, fieldValues);
    for (let i = 0; i < rows; i++) {
      const discName = repeater.variants?.discriminator.replace(/\{i\}/g, String(i));
      const shape = activeRowShape(repeater, i, fieldValues);
      for (const field of repeaterFields) {
        const resolved = field.name.replace(/\{i\}/g, String(i));
        const isDiscriminator = discName !== undefined && resolved === discName;
        // Variant filtering: on a polymorphic repeater, only the chosen shape's
        // inputs exist. Attempting the others produces phantom failures for
        // fields myUSCIS was never going to render for this row.
        if (!isDiscriminator && shape && !shape.includes(rowFieldSuffix(field.name))) continue;
        if (field.name.includes("{j}")) {
          // NESTED list inside this row (the travel page's per-trip countries).
          // Expand until the payload runs out; a literal {j} reaching a plan can
          // only fail to match an input, so it must never survive.
          for (let j = 0; j < MAX_NESTED_ITEMS; j++) {
            const nested = resolved.replace(/\{j\}/g, String(j));
            const v = fieldValues[nested];
            if (v === undefined || v === "") break;
            collect(field, i, { nestedIndex: j });
          }
          continue;
        }
        collect(field, i, { isDiscriminator });
      }
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
    if (locateElement(spec) !== null) return true;
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

  // Rows render LAZILY — immediately before the first ROW field, never up front.
  // Clicking a repeater Add COVERS the page's plain inputs, which is why
  // /your-family/children reported its count field missing on a live run. The plan
  // is already sorted plain-first, so deferring Add is all that is needed.
  let rowsRendered = false;
  // How far the DOM's row numbering runs ahead of the payload's. Zero on a blank
  // draft; on a draft that already holds rows it is however many are saved, learned
  // from the index the FIRST Add actually opened rather than assumed or counted.
  let rowOffset = 0;
  const renderRowsOnce = async (): Promise<void> => {
    if (rowsRendered || !page.repeater) return;
    rowsRendered = true;
    // Count rows from the {i} fields
    // only (so single-instance fields on a mixed page don't inflate the count).
    // Row 0 usually renders after one Add click; the dump shows repeaters render
    // no inputs until Add (on a mixed page row 0 may already be present).
    const repeaterFields = page.fields.filter((f) => f.name.includes("{i}"));
    const rows = repeaterRowCount(page.repeater, repeaterFields, fieldValues);
    for (let i = 0; i < rows; i++) {
      const rendered = await ensureRepeaterRow(page.repeater, i + rowOffset);
      if (i === 0 && rendered !== null) rowOffset = rendered;
    }
  };

  /**
   * The spec to actually drive, with the payload's row index shifted onto the row
   * myUSCIS rendered. Plain (non-repeater) fields are untouched, and with no offset
   * this is the identity — so a blank draft behaves exactly as before.
   */
  const onRenderedRow = (p: PlannedField): FieldSpec => {
    if (p.plain || rowOffset === 0 || !page.repeater) return p.spec;
    const prefix = page.repeater.namePrefix;
    return {
      ...p.spec,
      name: p.spec.name.replace(`${prefix}.${p.rowIndex}.`, `${prefix}.${p.rowIndex + rowOffset}.`),
    };
  };

  let lastWasRadio = false;
  let skipped = 0;
  for (const p of plan) {
    if (!p.plain) await renderRowsOnce();
    // AFTER renderRowsOnce, which is what learns the offset.
    const spec = onRenderedRow(p);
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
      const appeared = await waitForRevealed(spec);
      if (!appeared) {
        dbg(
          `fill: ${p.spec.name} did not appear after setting "${p.revealedBy.by}" — ` +
            `the reveal is wrong or the form changed`,
        );
      }
    } else if (p.conditional && locateElement(spec) === null) {
      // Conditional with NO declared reveal: all we can do is look. Absent means a
      // legitimate non-reveal (this branch hides the block), so skip it quietly
      // instead of counting a failure. Probed AFTER the radio-settle above so a
      // field a same-page radio just revealed is seen as present.
      skipped++;
      dbg(`fill: skip ${spec.name} — conditional field not shown on this page`);
      lastWasRadio = false;
      continue;
    }

    // A field the FORM has made read-only is not ours to set, and its value is
    // already whatever the form decided it should be. myUSCIS mirrors the physical
    // address into the mailing block and marks all seven inputs readOnly the moment
    // the client says the two addresses are the same.
    //
    // We got that wrong in both directions. The two autocompletes reported "no
    // match", because a read-only box will not open a listbox. The other five
    // reported SUCCESS — setText's native-setter strategy assigns straight through
    // readOnly — so we were overwriting the form's own values and counting it as
    // filled. That only looked harmless because the mirrored values equalled ours.
    //
    // Checked here rather than in setValue so it lands in `skipped` beside the
    // conditional non-reveals: both are "legitimately not filled", which is what the
    // count means, and neither is a failure anyone should chase.
    const el = locateElement(spec);
    if (el && "readOnly" in el && (el as HTMLInputElement).readOnly) {
      skipped++;
      dbg(`fill: skip ${spec.name} — the form has made it read-only, so its value is not ours to set`);
      lastWasRadio = false;
      continue;
    }

    const res = await setValue(spec, p.value);
    results.push(res);
    if (!res.success) dbg(`fill: FAIL ${spec.name} — ${res.message}`);
    lastWasRadio = p.spec.kind === "radio" && res.success;

    // This answer opens a block below it. Give the block a chance to mount before
    // the next field is looked up — the wait ends as soon as it renders.
    if (p.reveals && res.success) {
      const revealed = plan.find((q) => q.revealedBy?.by === p.spec.name);
      if (revealed) await waitForRevealed(revealed.spec);
    }

    // After country/state autocomplete, wait for dependent lookups.
    const n = spec.name.toLowerCase();
    if ((n.includes("country") || n.includes("state")) && spec.kind === "search" && res.success) {
      await sleep(1200);
    }
  }

  // A page whose row fields were ALL dropped from the plan still gets its rows
  // rendered, so the walk's Save/Next logic sees the real page, not a collapsed one.
  await renderRowsOnce();

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

/** Every row index currently rendered for `namePrefix`, read off the input names. */
function renderedRowIndices(namePrefix: string): number[] {
  const found = new Set<number>();
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const name = el.getAttribute("name");
    if (!name || !name.startsWith(`${namePrefix}.`)) continue;
    const n = Number(name.slice(namePrefix.length + 1).split(".")[0]);
    if (Number.isInteger(n)) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Make a row exist for payload row `index`, and report WHICH index myUSCIS gave it.
 *
 * The returned number is the whole point. myUSCIS numbers a new row AFTER the rows
 * the draft already holds, so on a draft with one saved address the row that "Add
 * another address" opens is `...whereYouHaveLived.1.*` while our payload counts from
 * 0. This used to assert the row it wanted, poll three seconds for a name that was
 * never coming, and return silently — every field on the page then reported "element
 * not on page" and the walk stalled trying to commit a row that had never rendered.
 * Live on draft 13375119 that was /about-you/where-you-have-lived at 0/7 and
 * /about-you/schools-and-employment at 0/3, which is where the run died.
 *
 * Discovered rather than counted: reading the number of saved-row summaries would
 * mean parsing myUSCIS's row markup, whereas the index it actually used is right
 * there in the new inputs' names. A blank draft answers 0 and a draft with rows
 * answers 1 through the same code path.
 *
 * null means no row appeared at all — a missing Add control or a click that did
 * nothing, both of which are failures worth a line rather than silence.
 */
async function ensureRepeaterRow(
  repeater: RepeaterSpec,
  index: number,
): Promise<number | null> {
  if (rowRendered(`${repeater.namePrefix}.${index}.`)) return index;
  const before = renderedRowIndices(repeater.namePrefix);
  const btn = findAddButton(repeater.addButtonText);
  if (!btn) {
    dbg(`fill: no "Add" button (${repeater.addButtonText}) to render row ${index}`);
    return null;
  }
  btn.click();
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(150);
    const fresh = renderedRowIndices(repeater.namePrefix).filter((n) => !before.includes(n));
    if (fresh.length) {
      const rendered = Math.min(...fresh);
      if (rendered !== index) {
        dbg(`fill: "${repeater.addButtonText}" opened row ${rendered}, not ${index} — filling ${rendered}`);
      }
      return rendered;
    }
  }
  dbg(`fill: clicked "${repeater.addButtonText}" but no new row rendered for ${index}`);
  return null;
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
 *
 * 180s, and the size is the point. This was 8s (a guess), then 45s, then 20s —
 * and 20s stopped a live run dead with FOUR of ten files still uploading on the
 * Additional-evidence page (an 8.5MB I-797 among them). A generous window is safe
 * here precisely because the wait is gated on a REAL signal and ticks every 5s:
 * it cannot hang silently, and it returns the instant the last upload lands. Being
 * stingy costs a whole run; being generous costs nothing.
 *
 * The signal is myUSCIS's own per-row control — "Cancel" while a file is
 * uploading, swapped for "Remove" when it lands — not a guess at spinner CSS
 * classes. Clicking Next before they finish is what raised USCIS's "your files
 * have not finished uploading" modal on the 2026-07-29 run. */
const UPLOAD_SETTLE_TIMEOUT_MS = 180000;
/** How many times to click Next on an upload page before giving up. myUSCIS
 * enables Next straight away but ignores the click until the file has finished
 * processing, and nothing in the DOM reliably says when that is — so we click,
 * check whether the page moved, and click again. */
const UPLOAD_ADVANCE_ATTEMPTS = 6;
/** How long to give the page to change after each click. */
const UPLOAD_ADVANCE_WAIT_MS = 12000;
/** Pause between click attempts. 6 attempts x (12s + 8s) ~= 2 minutes, which
 * comfortably covers a 10MB scan without ever looking hung: every attempt logs. */
const UPLOAD_ADVANCE_RETRY_MS = 8000;
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
// "Save and exit/close", "Save draft", "Save for later" all LEAVE the form.
const LEAVE = /save\s+(and|&)\s+(exit|close)|save\s+draft|save\s+for\s+later/;

export function findSaveButton(
  doc: Document = document,
  preferredLabel?: string,
): HTMLElement | null {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).filter((b) => !b.closest('nav, aside, header, [role="navigation"]'));
  // 0. The descriptor's captured label, when it has one, matched EXACTLY.
  //
  // The N-400 uses four different labels across its repeaters ("Save entry",
  // "Save child", "Save", "Save response"), and a bare "Save" is a substring of
  // the other three — so the generic passes below can resolve ambiguously on a
  // page that renders more than one. Preferring the label we actually captured
  // removes the guess. Exact rather than substring for the same reason.
  if (preferredLabel) {
    const want = preferredLabel.trim().toLowerCase();
    for (const b of candidates) {
      if ((b.textContent || "").trim().toLowerCase() === want && !LEAVE.test(want)) return b;
    }
    dbg(`nav: declared commit button "${preferredLabel}" not found — falling back to a generic match`);
  }
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
 * The row-commit button for a repeater page, matched on the descriptor's EXACT
 * captured label and nothing else.
 *
 * Deliberately narrower than findSaveButton. This one runs while a Next button is
 * on the page, where "any save-ish control" would be a guess with a real cost --
 * the N-400 renders four different commit labels and a bare "Save" is a substring
 * of three of them. A label that does not match returns null and the walk simply
 * tries Next, which is what it did before.
 */
export function findRowCommitButton(
  label: string | undefined,
  doc: Document = document,
): HTMLElement | null {
  const want = (label ?? "").trim().toLowerCase();
  if (!want || LEAVE.test(want)) return null;
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).filter((b) => !b.closest('nav, aside, header, [role="navigation"]'));
  for (const b of candidates) {
    if ((b.textContent || "").trim().toLowerCase() === want) return b;
  }
  return null;
}

/**
 * The error text myUSCIS is showing right now, as one line, or "" when it shows
 * none.
 *
 * A refused Next used to stop the walk with "page did not change after Next",
 * which is equally true of an uncommitted repeater row, a blank required field
 * and a form that changed shape. Nothing read the page's own error text, so
 * telling those apart meant reading the source -- on 2026-08-29 that was the
 * whole cost of answering "why did it stop on page 6 of 58".
 *
 * The extension's own chrome is excluded: the stale-context notice is itself a
 * role="alert", and reporting our own banner back as USCIS's error would be
 * worse than silence.
 */
export function pageErrorSummary(doc: Document = document): string {
  const SELECTORS = [
    '[role="alert"]',
    ".usa-error-message",
    ".usa-alert--error",
    ".Mui-error",
    ".error-message",
  ].join(", ");
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(SELECTORS))) {
    if (el.closest('[id^="mk-family"]')) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    messages.push(text.length > 160 ? `${text.slice(0, 160)}...` : text);
    if (messages.length >= 6) break;
  }
  const flagged = Array.from(doc.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))
    .map((el) => el.getAttribute("name") || el.getAttribute("id") || "")
    .filter(Boolean)
    .slice(0, 8);
  const parts: string[] = [];
  if (messages.length) parts.push(`myUSCIS is showing: ${messages.join(" | ")}`);
  if (flagged.length) parts.push(`fields it flagged: ${flagged.map(shortName).join(", ")}`);
  return parts.length ? ` -- ${parts.join("; ")}` : "";
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
    // locateElement, not findByName: a page whose fields are all LOCATED (no
    // usable name attribute) would otherwise read as "not this page".
    return plan.some((p) => locateElement(p.spec) !== null);
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
  // Reports how many files it attached, so the advance logic can tell "myUSCIS is
  // still processing an upload" from "there was no upload".
  onUploadPage: (page: FormPage) => Promise<number | void>,
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
    // null = the callback did not say, so assume something may be processing.
    let attachedHere: number | null = null;
    // Set by the upload branch, which does its own click-and-retry advance.
    let advanced = false;
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
            attachedHere = (await onUploadPage(page)) ?? null;
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
      // NOTHING attached means nothing is uploading, so there is no settle to wait
      // for and no reason to give Next the long upload window. Skipping both is
      // what turns a minute of "still processing the upload" into one click.
      const nothingAttached = attachedHere === 0;
      if (!nothingAttached) await waitForUploadToSettle();
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
      const nextWindow = nothingAttached ? DEFAULT_NEXT_TIMEOUT_MS : UPLOAD_NEXT_TIMEOUT_MS;
      dbg(
        nothingAttached
          ? `fillAll: nothing attached on ${page?.slug ?? "this page"} — not waiting on an upload`
          : `fillAll: uploads settled on ${page?.slug ?? "this page"} — waiting for Next ` +
              `to enable (up to ${Math.round(nextWindow / 1000)}s)`,
      );
      const next = await waitForNextEnabled(nextWindow);
      if (!next || next.disabled) {
        dbg(
          "fillAll: Next never enabled on this upload page — either no file was " +
            "attached (a required upload with nothing resolved) or the upload is " +
            "still processing. Stopping; attach the file by hand and re-run.",
        );
        break;
      }
      // CLICK, AND CLICK AGAIN IF NOTHING HAPPENS.
      //
      // This is the fix for the thing that made Fill all need two clicks. On an
      // upload page myUSCIS ENABLES Next immediately but silently IGNORES the
      // click until the file has finished processing server-side. Nothing in the
      // DOM reliably says when that is: the row's action control is "Cancel" while
      // uploading on some rows and ABSENT on others (seen live 2026-07-29), so a
      // control-based signal reads "settled" while a 10MB scan is still going.
      //
      // So stop trying to read USCIS's mind and use the OUTCOME instead: if the
      // page did not move, the click was too early — wait and click again. That is
      // exactly what a second Fill all was doing by hand.
      advanced = false;
      // With NOTHING attached there is no server-side processing to wait for, so
      // the retry loop would spend a minute insisting myUSCIS was busy. One click.
      const attempts = attachedHere === 0 ? 1 : UPLOAD_ADVANCE_ATTEMPTS;
      if (attachedHere === 0) {
        dbg("fillAll: nothing attached here — advancing once instead of retrying");
      }
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const btn = findNextButton() ?? next;
        btn.click();
        if (await waitForPageChange(prevUrl, UPLOAD_ADVANCE_WAIT_MS)) {
          advanced = true;
          break;
        }
        if (attempt < attempts) {
          dbg(
            `fillAll: Next did not move the page (attempt ${attempt}/${attempts}) — ` +
              `myUSCIS is still processing the upload; waiting and clicking again`,
          );
          await sleep(UPLOAD_ADVANCE_RETRY_MS);
        }
      }
      if (!advanced) {
        dbg(
          `fillAll: Next would not advance past ${page?.slug ?? "this upload page"} after ` +
            `${attempts} attempt${attempts === 1 ? "" : "s"}. ` +
            (attachedHere === 0
              ? "Nothing was attached here, so this is a page myUSCIS will not let " +
                "us leave empty — attach the document in ParaLeagle and re-run."
              : "The upload is taking longer than expected — let it finish and re-run."),
        );
        break;
      }
    } else {
      // A REPEATER ROW IS NOT PART OF THE PAGE UNTIL IT IS COMMITTED.
      //
      // Some repeater pages show only their commit button until the row is saved
      // (waiting out the full Next window there cost 12s on each of three pages
      // of a live run). Others -- /about-you/where-you-have-lived among them --
      // show the row's "Save entry" AND the footer's Next at the same time, and
      // refuse that Next while the row is still open. Gating the commit on Next
      // being ABSENT handled the first shape and walked straight into the second:
      // on 2026-08-29 the N-400 typed 6/6 on where-you-have-lived and stopped
      // dead there, six pages into fifty-eight.
      //
      // So commit whenever the descriptor's exact label is on the page. Once a row
      // is committed myUSCIS removes that button, so there is nothing to click and
      // nothing changes for the pages that were already working.
      if (page?.repeater?.rowCommitButtonText) {
        const commit = findRowCommitButton(page.repeater.rowCommitButtonText);
        if (commit) {
          dbg(`fillAll: committing the row with "${page.repeater.rowCommitButtonText}" before Next`);
          commit.click();
          await sleep(600);
        }
      }
      // A commit that advanced the page on its own must not then have the NEXT
      // page's Next clicked -- that would skip a page unfilled.
      if (window.location.href !== prevUrl) {
        advanced = true;
        dbg("fillAll: the commit advanced the page on its own");
      }
      let next = advanced ? null : await waitForNextEnabled();
      if (!next && !advanced) {
        // Repeater pages (e.g. /other-information/other-petitions) expose NO
        // Next/Continue until the just-entered row is COMMITTED via a "Save
        // Entry" button; clicking it surfaces the page's Next. Try that
        // save-then-next sequence before giving up.
        // Prefer the label the capture recorded for THIS page's repeater; the
        // generic passes are the fallback.
        const saveBtn = findSaveButton(document, page?.repeater?.rowCommitButtonText);
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

    if (!advanced && !(await waitForPageChange(prevUrl))) {
      const why = pageErrorSummary();
      dbg(
        "fillAll: page did not change after Next, stopping" +
          (why ||
            " -- and the page is showing no error text, so this is not a field it " +
              "rejected. Most likely a row is still open or a control moved."),
      );
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
  dbg(`  correctly skipped (not shown, or read-only and the form's own): ${skipped}`);
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
