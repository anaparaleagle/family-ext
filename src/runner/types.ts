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

import { FieldKind } from "../engine/types";

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
      names.add(f.name.replace(/\{i\}/g, "0"));
    }
  }
  return [...names];
}
