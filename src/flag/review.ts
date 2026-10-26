// ===========================================================================
// SOF-2191 (porting the old portal's SOF-643) — "Review Summary": read the
// values FLAG is CURRENTLY holding on its own ETA-9035E draft, back out of the
// ordinary section inputs this descriptor already knows how to fill.
//
// This is deliberately NOT a scrape of FLAG's "Review & Submit" page — that
// page's DOM has never been captured, the fill chain is hard-forbidden from
// ever navigating there (see ETA9035_FORBIDDEN), and a live capture session
// would be needed to map it. It is unnecessary: every field worth comparing
// already has a known, stable `[name]` (the same one the fill chain writes
// to), so reading it back is the dual of setValue, not a new mapping problem.
//
// FLAG's ETA-9035E is multi-page (one section rendered at a time), so a single
// call only ever sees whatever section is on screen right now. The caller
// accumulates across page visits (see content.ts) the same way the old
// extension's Review Summary built up its picture page by page — a field
// absent on this page is simply omitted, never reported as blank.
// ===========================================================================

import { locateElement } from "../engine/value-setter";
import { FlagField, flagFieldSpec } from "./types";
import { ETA9035_SECTIONS } from "./eta9035-descriptor";

/**
 * The FLAG fields compared against the questionnaire, named exactly as
 * `cases.lca_summary_compare.COMPARE_FIELDS` keys them on the backend — both
 * sides have to agree on the key or every field silently stops comparing.
 *
 * The worksite county (`_section_f_f7_work_county_id`) is deliberately absent:
 * the backend never resolves a value for it either (a ZIP can straddle two
 * counties, so it is always a suggestion for a person to pick), and comparing
 * a box neither side ever fills would flag every case, forever.
 */
const REVIEW_FIELD_NAMES = [
  "b1_job_title",
  "b2_soc_code",
  "b5_begin_date",
  "b6_end_date",
  "c1_emp_name",
  "c3_emp_address_1",
  "c5_emp_city",
  "c6_emp_state_id",
  "c7_emp_zip",
  "_section_f_f4_work_address_1",
  "_section_f_f6_work_city",
  "_section_f_f8_work_state_id",
  "_section_f_f9_work_zip",
  "_section_f_f10_nonimmigrant_wage_from",
  "_section_f_f10a_nonimmigrant_wage_per",
  "_section_f_f11_prevailing_wage",
  "_section_f_f11a_prevailing_wage_per",
] as const;

/** name -> the field's own descriptor entry, so the review reads it exactly
 * the way the fill chain writes it (same `kind`, same byId/byLabel). Built
 * from ETA9035_SECTIONS rather than redeclared, so the two can never drift. */
const FIELDS_BY_NAME: Record<string, FlagField> = Object.fromEntries(
  ETA9035_SECTIONS.flatMap((s) => s.fields).map((f) => [f.name, f]),
);

export const REVIEW_FIELDS: FlagField[] = REVIEW_FIELD_NAMES
  .map((name) => FIELDS_BY_NAME[name])
  .filter((f): f is FlagField => !!f);

/** Read a radio group's CURRENTLY CHECKED value, by name. `locateElement`
 * deliberately returns only the first radio in a group (right for filling,
 * where the caller supplies which value to check) — this needs whichever one
 * IS checked, so it queries directly. */
function readRadioValue(name: string): string {
  const checked = document.querySelector<HTMLInputElement>(
    `input[name="${CSS.escape(name)}"]:checked`,
  );
  return (checked?.value ?? "").trim();
}

/** Read one field's current value off the live FLAG page, "" when absent. */
export function readFlagValue(field: FlagField): string {
  if (field.kind === "radio") return readRadioValue(field.name);

  const el = locateElement(flagFieldSpec(field));
  if (!el) return "";

  if (el.tagName === "SELECT") {
    const sel = el as HTMLSelectElement;
    const opt = sel.selectedOptions[0];
    return ((opt?.text || sel.value) ?? "").trim();
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "").trim();
  }
  return "";
}

/** Scrape whatever review fields are rendered on the CURRENT page. A field not
 * on this page is omitted, not reported as blank — the caller merges this
 * across every section visited. */
export function scrapeReviewFields(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of REVIEW_FIELDS) {
    const value = readFlagValue(field);
    if (value !== "") values[field.name] = value;
  }
  return values;
}
