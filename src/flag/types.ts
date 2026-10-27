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

import { FieldKind, FieldSpec } from "../engine/types";

/** What makes a conditional field render. Mirrors the myUSCIS RevealSpec. */
export interface FlagReveal {
  /** DOM name of the radio/select whose answer reveals this field. */
  by: string;
  /**
   * The values of `by` that reveal it. These are FLAG's own option values, not
   * "Yes"/"No" — on the ETA-9141 Yes is `"1"`. Omit when any answer reveals it.
   */
  is?: string[];
  /**
   * Where this gate comes from, when it is NOT in the capture file.
   *
   * Required for such a gate, because the capture is the evidence everything
   * else here rests on, and one carried from somewhere else — DOL's printed
   * wording, a live check run later — is indistinguishable from a guess unless
   * it says so. Name the source and the date.
   */
  source?: string;
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
  /**
   * Set when the input has NO name and NO id, only a printed box label. `name`
   * is then a LOGICAL key (the one the backend feed emits under) and the input
   * is found by this label; see LocateSpec.boxLabel for how strict that is.
   * The ETA-9035's B.2/B.3 SOC and C.13 NAICS comboboxes.
   */
  byLabel?: string;
  /**
   * Present when an upstream answer has to be driven before this renders.
   *
   * A LIST means OR: any one of the gates answered with a revealing value is
   * enough. The ETA-9035's H.3 is why — DOL's own wording is "If Yes to H.1
   * AND/OR H.2", so a willful violator that is not H-1B dependent reveals it on
   * H.2 alone. The capture only ever toggled H.1, so a single-gate rule here
   * read "H.1 only" and the willful-violator case silently lost H.3 — a
   * required box left blank, and the section then refuses to save.
   */
  revealedBy?: FlagReveal | FlagReveal[];
  /**
   * Only typed when its amount is strictly ABOVE the amount in this other box.
   *
   * The ETA-9035's F.10 is a wage RANGE, and FLAG validates it: "The 'To' must
   * be higher than the 'From' wage rate". A case with no range still has a
   * salary max — ours comes back equal to the min — and typing it leaves that
   * error standing, which in turn keeps "Add Place of Employment" disabled and
   * the whole section uncommittable. A max that is not a range is not an answer
   * to the box, so it is not typed.
   */
  onlyAbove?: string;
  /**
   * Re-checked once the whole section is typed, and re-answered if it drifted.
   *
   * The ETA-9035's F.10a is why, and it is the old extension's step 7b: FLAG
   * defaults the offered-wage unit to Year, and typing a wage amount after the
   * unit can reset it — "$43 / Hour" silently becomes "$43 / Year", which FLAG
   * then refuses as below the state minimum.
   */
  reassert?: true;
}

/**
 * A field inside a FLAG modal — the OES Wage Calculator being the one.
 *
 * Its value is NOT in the feed. The backend's table describes boxes on the
 * application form, and the calculator is a DOL tool that sits over it; every
 * input it wants is either one the feed already sends for Section F (`from`) or
 * a standing choice this extension makes and says out loud (`constant`).
 */
export interface FlagModalField {
  /** `name` for a radio group, otherwise the input's id (see `byId`). */
  name: string;
  kind: FieldKind;
  /** The input has no name; find it by `#id`. */
  byId?: true;
  /** Take the value from this Section F field of the feed. */
  from?: string;
  /** A standing choice this extension makes, listed in the toolbar. */
  constant?: string;
  /**
   * Filled only AFTER Calculate. FLAG keeps the wage level and the per-unit
   * disabled until the calculator has an answer to apply them to.
   */
  afterCalculate?: true;
  /**
   * Pause before this one for its options to be rebuilt.
   *
   * The old extension did exactly this, for the area combobox only: its list
   * depends on the state and the area basis answered above it.
   */
  waitBefore?: true;
}

/**
 * A modal the section is driven through before its own boxes are typed.
 *
 * Open it, fill it, press its Calculate, check it produced an answer, press its
 * Submit. Every one of those is a named button rather than a selector, because
 * FLAG's modal markup has already been redesigned once under the old extension.
 */
export interface FlagModalSpec {
  /** Button on the section that opens it. */
  openButton: string;
  /** Run it only when this gate holds one of these values. */
  onlyWhen: FlagReveal;
  fields: FlagModalField[];
  calculateButton: string;
  /** The box the modal writes its answer into — the proof it worked. */
  resultField: string;
  submitButton: string;
  /**
   * Boxes on the SECTION that this modal owns and fills itself.
   *
   * They are left alone whenever the modal runs. FLAG disables them while the
   * calculator owns them, and the old extension found that writing to them
   * anyway replaced a correct hourly prevailing wage with the annual PWD the
   * case stores — F.10 then reads as below the prevailing wage and the filing
   * is refused.
   */
  owns: string[];
}

/**
 * A section whose fields are ONE ROW of a table, committed with its own button.
 *
 * The ETA-9035's Section F is this and nothing else made that obvious: the
 * worksite boxes look like an ordinary section, and FLAG prints the warning
 * "If you navigate away from this page without clicking the 'Add Place of
 * Employment' button, your changes will be lost." Typing the boxes and pressing
 * Continue leaves "0 Entries for Place of Employment" and the error
 * "Field F: Please enter in at least one row."
 */
export interface FlagRepeaterSpec {
  /** Visible text on the button that commits the row. */
  addButtonText: string;
  /**
   * The field names that belong to ONE row, so a second worksite can be typed
   * over the first one's boxes while everything else on the section — the
   * wages, the source, the worker count — stays as it is.
   *
   * This is the old extension's patch, by its FLAG names: it rebuilt the whole
   * payload with F.4 to F.9 replaced and re-ran Section F for each extra site.
   */
  rowFields: string[];
  /**
   * Text FLAG prints over the table of committed rows, e.g. "Entries for Place
   * of Employment". The count in front of it is how a commit is PROVEN rather
   * than assumed — FLAG disables the button until the row validates, and a
   * click on a disabled button is silent.
   */
  entriesLabel: string;
}

/** A box the extension leaves for a person, said up front in the toolbar. */
export interface NotAutofilled {
  box: string;
  label: string;
  reason: string;
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
  /** Driven after its gate field and before the rest of the section. */
  modal?: FlagModalSpec;
  /** Present when the section's fields are one row of a table. */
  repeater?: FlagRepeaterSpec;
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
  /** Boxes left for a person, listed in the toolbar. */
  notAutofilled?: NotAutofilled[];
}

/** The engine spec for a field: by name, or by id / box label when it has no name. */
export function flagFieldSpec(field: FlagField | FlagModalField): FieldSpec {
  if (field.byId) return { name: field.name, kind: field.kind, locate: { id: field.name } };
  if ("byLabel" in field && field.byLabel) {
    return { name: field.name, kind: field.kind, locate: { boxLabel: field.byLabel } };
  }
  return { name: field.name, kind: field.kind };
}

/**
 * The value for a modal field: the Section F value the feed sent, or our own
 * standing choice. Empty when the feed has nothing and we made no choice.
 */
export function modalFieldValue(
  field: FlagModalField,
  values: Record<string, string>,
): string {
  if (field.from) return values[field.from] ?? "";
  return field.constant ?? "";
}

/** Is `gate` answered, in `values`, with one of the answers that fires it? */
export function gateIsAnswered(gate: FlagReveal, values: Record<string, string>): boolean {
  const answer = values[gate.by];
  if (answer === undefined || answer === "") return false;
  return !gate.is || gate.is.includes(answer);
}

/**
 * The gates that reveal a field, as a list, whatever shape the descriptor used.
 *
 * One place to ask, so nothing downstream has to know that `revealedBy` can be
 * a single gate or several. An empty list means the field is unconditional.
 */
export function revealGates(field: FlagField): FlagReveal[] {
  if (!field.revealedBy) return [];
  return Array.isArray(field.revealedBy) ? field.revealedBy : [field.revealedBy];
}

/** Every field name a descriptor drives, for coverage accounting. */
export function flagFieldNames(sections: FlagSection[]): string[] {
  return [...new Set(sections.flatMap((s) => s.fields.map((f) => f.name)))];
}
