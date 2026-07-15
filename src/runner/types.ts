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

export interface DescriptorField {
  /** Formik `[name]` — matches the backend payload key exactly. */
  name: string;
  kind: FieldKind;
  /** Documented radio/select option codes (engine selects by the emitted value). */
  options?: string[];
  /**
   * True when the input only renders after an upstream answer reveals it (a
   * conditional reveal). The fill-chain does not treat these specially — the
   * value-setter reports "element not on page" and moves on — but marking them
   * keeps the descriptor honest about what a happy-path page actually shows,
   * and lets the audit explain a legitimate absence.
   */
  conditional?: boolean;
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

/** Same as the helpers above, but marks the field as a conditional reveal. */
export const cond = (field: DescriptorField): DescriptorField => ({ ...field, conditional: true });

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
