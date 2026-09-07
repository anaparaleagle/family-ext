// ===========================================================================
// SHARED FORM-DESCRIPTOR TYPES — the vocabulary every myUSCIS guided online
// form descriptor is written in, plus the FormConfig that binds a descriptor to
// its host path.
//
// A descriptor drives HOW to fill/navigate a form: page order, URL slugs,
// per-field kind, repeater flags, upload-only pages. It does NOT decide WHAT
// value a field gets — the backend map owns that and emits {formik_name: value}.
// The fill-chain matches descriptor names against the backend payload; a name
// present here but absent from the payload is simply skipped.
//
// Nothing in this file knows about I-130, I-539, or family-visa data.
// ===========================================================================

import { FieldKind, LocateSpec } from "../engine/types";

/**
 * What makes a conditional field render.
 *
 * Marking a field `conditional` says "this may legitimately be absent". Saying
 * WHICH answer reveals it is what lets the fill-chain do something useful:
 * drive that answer first, wait for the block to render, and tell a genuine
 * non-reveal apart from a real failure.
 */
export interface RevealSpec {
  /** The field whose answer reveals this one. */
  by: string;
  /**
   * The value(s) of `by` that reveal it. Omit when ANY non-blank answer does
   * (e.g. the premium radio appears once a change-to target is chosen, whichever
   * status that is).
   */
  is?: string | string[];
}

export interface DescriptorField {
  /** Formik `[name]` — matches the backend payload key exactly. */
  name: string;
  kind: FieldKind;
  /** Documented radio/select option codes (engine selects by the emitted value). */
  options?: string[];
  /**
   * True when the input only renders after an upstream answer reveals it (a
   * conditional reveal). On its own this only means "a legitimate absence is
   * possible" — the fill-chain probes for the element and skips quietly rather
   * than reporting a failure.
   */
  conditional?: boolean;
  /**
   * WHICH answer reveals this field. When present the fill-chain:
   *   - orders `by` before this field, however deep the chain (radios-first is
   *     too coarse — the premium radio is revealed by a SEARCH field);
   *   - waits for this field's input to actually render after `by` is set,
   *     instead of a fixed sleep;
   *   - skips this field when the payload has no value for `by` (we could never
   *     have revealed it, so there is nothing to do and nothing to report);
   *   - keeps a genuine FAILURE loud when `by` WAS driven and the field still
   *     did not appear — that is a broken reveal, not an absent one.
   */
  revealedBy?: RevealSpec;
  /**
   * How to find this input when its `name` is not in the DOM.
   *
   * Needed because myUSCIS does not always give an input a Formik path: the
   * N-400's current-address "To" date has a random UUID for a name. With `locate`
   * set, `name` becomes a LOGICAL key — what the backend emits the value under —
   * and the element is found structurally (or by label) instead.
   */
  locate?: LocateSpec;
}

/**
 * A repeater nested INSIDE each row of another repeater.
 *
 * The N-400's travel history is the first of these: each trip row carries its own
 * list of countries visited (`...timeSpentOutsideUSTable.{i}.countries.{j}`) with
 * its own "Add country" button. A single namePrefix + addButtonText cannot express
 * that, so a nested list gets its own spec rather than being crammed into the
 * parent's.
 */
export interface NestedRepeaterSpec {
  /**
   * Field-name prefix of the inner list, RELATIVE to the parent row and still
   * containing the parent's `{i}` — e.g.
   * "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.countries".
   * Inner items are `${namePrefix}.${j}`.
   */
  namePrefix: string;
  /** Visible text on the inner "Add ..." control (e.g. "Add country"). */
  addButtonText: string;
}

/**
 * A repeater whose ROW SHAPE is chosen by a discriminator field.
 *
 * The N-400's schools-and-employment repeater is one repeater with FOUR row
 * shapes — employer, self-employment, unemployment, school — selected by an
 * autocomplete. The shapes are not supersets of each other: an unemployment row
 * has no address block and no occupation, and a school row swaps
 * `employmentInfo.*` for `schoolInfo.*`. So a single flat row field list would
 * make the chain hunt for inputs that legitimately do not exist and report them
 * as failures.
 */
export interface RowVariantSpec {
  /**
   * The field whose value picks the shape, relative to the row and containing
   * `{i}` — e.g. "applicant.schoolsAndEmployment.{i}.schoolOrEmploymentType".
   * Must be driven FIRST; the rest of the row does not render until it is set.
   */
  discriminator: string;
  /**
   * Discriminator value -> the field names that row shape renders. Keys are the
   * exact option text the widget commits (these are autocompletes, so the text
   * must match byte for byte).
   */
  shapes: Record<string, string[]>;
}

export interface RepeaterSpec {
  /**
   * Index-0 field-name prefix used to detect whether a row is rendered, e.g.
   * "applicant.yourAddressHistory". Rows use `${prefix}.${i}.<rest>`.
   */
  namePrefix: string;
  /**
   * Visible text on the "Add ..." button for this repeater (lower-cased
   * substring match). Clicking it renders the next indexed row.
   */
  addButtonText: string;
  /**
   * Visible text on the control that COMMITS a row, when the row is committed
   * separately from the page.
   *
   * This is NOT cosmetic and NOT guessable. Across the N-400's repeaters the
   * label is "Save entry", "Save child", "Save" or "Save response" depending on
   * the page, and the I-539 already lost a build to matching advance controls by
   * literal text ("Save Entry" did not match). Omit when the row needs no
   * separate commit; supply the exact captured string when it does.
   */
  rowCommitButtonText?: string;
  /** Present when each row contains its own nested list. */
  nested?: NestedRepeaterSpec;
  /** Present when the row shape depends on a discriminator answer. */
  variants?: RowVariantSpec;
}

export type PageKind = "form" | "upload" | "review";

export interface FormPage {
  /** URL slug under the form base path. */
  slug: string;
  /** Human label (sidebar section / heading) for detection + logging. */
  title: string;
  kind: PageKind;
  /** Fillable fields, in DOM order. Empty for upload/review/intro pages. */
  fields: DescriptorField[];
  /** Present when this page is a repeater (address/employment history etc.). */
  repeater?: RepeaterSpec;
  /**
   * Conditional page — only reachable when upstream answers are set (e.g. the
   * I-130 spouse-only pages, the I-539 preparer pages). The chain tolerates
   * these being absent.
   */
  conditional?: boolean;
}

/**
 * One guided online form the extension can drive. `hostPath` is the path
 * fragment that identifies the form on my.uscis.gov; the registry picks a
 * config by matching it against window.location.pathname.
 */
export interface FormConfig {
  /** Backend form_type, e.g. "I-130" — also what the popup requests. */
  formType: string;
  /** Path fragment identifying this form's host, e.g. "/forms/petition-for-a-relative/". */
  hostPath: string;
  /** Toolbar label shown to the user. */
  label: string;
  /** The page walk, in order. */
  pages: FormPage[];
  /**
   * Backend case-type codes filed on this form. Used to follow the caseworker's
   * case selection with the form picker; NOT to filter the case list, which stays
   * open on purpose (see flag/registry `caseTypesForForm`).
   *
   * Optional so a throwaway config in a test need not carry one. Every SHIPPED
   * config must, and `runner.test.ts` fails the build if one does not.
   */
  caseTypes?: string[];
}

// ── Descriptor authoring helpers ────────────────────────────────────────────
// Shared by every form descriptor so the field tables stay dense + readable.

export const t = (name: string): DescriptorField => ({ name, kind: "text" });
export const search = (name: string): DescriptorField => ({ name, kind: "search" });
export const phone = (name: string): DescriptorField => ({ name, kind: "phone" });
export const radio = (name: string, options: string[]): DescriptorField => ({
  name,
  kind: "radio",
  options,
});
export const check = (name: string): DescriptorField => ({ name, kind: "checkbox" });
export const area = (name: string): DescriptorField => ({ name, kind: "textarea" });

/**
 * A field whose real `name` cannot be used — give it a logical name plus how to
 * find it. Structure first (`nearName`, a field name we verified), label second.
 *
 * `named("...toDate", t, { nearName: "...fromDate", labelContains: "To (MM/DD/YYYY)" })`
 */
export const located = (
  field: DescriptorField,
  locate: LocateSpec,
): DescriptorField => ({ ...field, locate });

/**
 * Same as the helpers above, but marks the field as a conditional reveal.
 *
 * Pass `revealedBy` whenever it is known — without it the chain can only probe
 * and shrug, so a field whose reveal we DO drive will still be attempted in the
 * wrong order and fail. With it, the chain drives the reveal first.
 */
export const cond = (field: DescriptorField, revealedBy?: RevealSpec): DescriptorField => ({
  ...field,
  conditional: true,
  ...(revealedBy ? { revealedBy } : {}),
});

/**
 * Every distinct fillable field name a descriptor drives (repeater `{i}`
 * resolved to index 0), for coverage accounting against a backend payload or a
 * live field dump.
 */
export function fieldNamesOf(pages: FormPage[]): string[] {
  const names = new Set<string>();
  for (const page of pages) {
    for (const f of page.fields) {
      // `{j}` is the inner index of a NESTED repeater (the N-400 travel page's
      // per-trip country list). Resolved alongside `{i}` so a nested field
      // accounts for itself in coverage instead of looking like an unmapped name.
      names.add(f.name.replace(/\{i\}/g, "0").replace(/\{j\}/g, "0"));
    }
  }
  return [...names];
}
