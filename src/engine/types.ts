// Generic value-setter types. The engine is data-agnostic: it knows how to set
// a value onto a DOM element of a given kind, nothing about I-130 or family
// data. The i130 layer supplies these descriptors.

export type FieldKind =
  | "text"
  | "textarea"
  | "date"
  | "radio"
  | "checkbox"
  | "select"
  | "search"
  | "phone";

/** What the engine needs to set one field. `name` is the Formik `[name]`. */
export interface FieldSpec {
  /** The Formik field name == the input's `name` attribute. */
  name: string;
  /** How to drive the input. */
  kind: FieldKind;
  /**
   * For radios/checkboxes whose on-page option value differs from the backend
   * value. Backend already emits the coded option (e.g. "1" for spouse), so
   * this is normally unused — present for completeness / yes-no aliasing.
   */
  optionValue?: string;
}

export interface SetResult {
  name: string;
  success: boolean;
  message: string;
}
