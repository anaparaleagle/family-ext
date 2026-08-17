// ===========================================================================
// FLAG DESCRIPTOR TYPES — the vocabulary a DOL form on flag.dol.gov is described
// in. Deliberately NOT the myUSCIS types in runner/types.ts, because the two
// portals differ in the one thing those types are built around.
//
// myUSCIS gives every page its own URL slug, so its descriptor is a page walk and
// its runner navigates by pathname. FLAG keeps ONE url for the whole application
// — every field in all three live captures came from
// `/dashboard/application/9141/<id>` — and moves between sections by clicking the
// sidebar. A slug-keyed page list has nothing to bind to here, so bending
// FormPage into this shape would mean a `slug` field that is always empty and a
// section detector that always fails.
//
// What a descriptor decides: which sections exist, in what order, which fields
// each holds, in what order, how to find each one, and which answer reveals it.
// What it does NOT decide: the value. That comes from the backend's eta-autofill
// feed, already coded to the exact string this form's widget accepts (the
// ETA-9141 spells Yes as "1"; the ETA-9089 spells it "Yes").
// ===========================================================================

import { FieldKind } from "../engine/types";

/** What makes a conditional field render. Mirrors the myUSCIS RevealSpec. */
export interface FlagReveal {
  /** DOM name of the radio/select whose answer reveals this field. */
  by: string;
  /**
   * The values of `by` that reveal it. These are FLAG's own option values, not
   * "Yes"/"No" — on the ETA-9141 Yes is `"1"`. Omit when any answer reveals it.
   */
  is?: string[];
}

export interface FlagField {
  /**
   * The input's `name` attribute — and the key the backend feed emits its value
   * under, so the two must agree exactly.
   */
  name: string;
  kind: FieldKind;
  /**
   * Set when the input has NO `name` attribute and must be found by `#id`.
   *
   * The ETA-9141's worksite county is the case: `<input id="primaryWorksiteCounty">`
   * with no name at all. The H-1B extension hit the same field on the LCA and
   * fixed it the same way. Without this the fill reports "element not on page"
   * for a field that is right there.
   */
  byId?: true;
  /** Present when an upstream answer has to be driven before this renders. */
  revealedBy?: FlagReveal;
}

export interface FlagSection {
  /**
   * Sidebar text used to navigate here, matched as a normalised substring.
   *
   * FLAG concatenates the section letter onto the title in its own markup
   * ("AEmployment Based Visa Information"), so the stored value is the part that
   * is stable — the title — and the letter is tolerated by substring matching.
   */
  navLabel: string;
  /** Human title for logging and the toolbar. */
  title: string;
  /** Fields in fill order. A gate is listed BEFORE the fields it reveals. */
  fields: FlagField[];
  /**
   * True when this section legitimately renders nothing until an upstream answer
   * is committed. The walk reports these as skipped rather than as a failure.
   */
  conditional?: boolean;
}

/** A control the runner must never touch, and why. Enforced, not advisory. */
export interface ForbiddenControl {
  /** Matched against a candidate element's name, id, or accessible label. */
  match: string;
  reason: string;
}

export interface FlagFormConfig {
  /** Backend form code — also the `?form=` the feed is requested with. */
  formType: string;
  /** Recognises the form from the URL. */
  urlPattern: RegExp;
  /** Toolbar label. */
  label: string;
  /**
   * Case type codes this form belongs to, used to filter the popup's case list.
   *
   * EXACT codes, never a prefix or substring match. `EB-2-PERM` is a separate,
   * pre-existing case type that the backend's ETA endpoints reject by name — so
   * a "contains PERM" filter would offer cases that can only ever answer 400,
   * and the caseworker would read that as the extension being broken.
   */
  caseTypes: string[];
  sections: FlagSection[];
  forbidden: ForbiddenControl[];
}

/** Every field name a descriptor drives, for coverage accounting. */
export function flagFieldNames(sections: FlagSection[]): string[] {
  return [...new Set(sections.flatMap((s) => s.fields.map((f) => f.name)))];
}
