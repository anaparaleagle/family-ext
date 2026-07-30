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

/**
 * How to find an input whose `name` attribute cannot be relied on.
 *
 * myUSCIS does not always give an input a Formik path. The N-400's current-address
 * "To" date has a RANDOM UUID for a name, regenerated per render, so no
 * name-keyed selector can ever reach it. For fields like that the descriptor
 * supplies a LOGICAL name (the key the backend emits the value under) plus this
 * spec (how to find the real element).
 *
 * It doubles as drift resilience for every form: when USCIS renames a field, a
 * declared anchor or label lets the fill survive instead of reporting
 * "element not on page".
 */
export interface LocateSpec {
  /**
   * The name of a nearby field whose name IS stable. The element is found as the
   * next same-type input after that anchor, within the anchor's own field group.
   *
   * Preferred over `labelContains`: an anchor name is something verified from a
   * live capture, whereas label text is derived and likelier to drift.
   */
  nearName?: string;
  /**
   * Visible label text (or aria-label) to match, compared as a
   * whitespace-normalised substring. Fallback, used when there is no anchor or
   * the anchor is not on the page.
   */
  labelContains?: string;
}

/** What the engine needs to set one field. `name` is the Formik `[name]`. */
export interface FieldSpec {
  /**
   * Normally the Formik field name == the input's `name` attribute.
   *
   * When `locate` is present this may instead be a LOGICAL name that appears
   * nowhere in the DOM. It is still the key the backend payload uses, so it stays
   * the field's identity for planning, logging and coverage.
   */
  name: string;
  /** How to drive the input. */
  kind: FieldKind;
  /**
   * For radios/checkboxes whose on-page option value differs from the backend
   * value. Backend already emits the coded option (e.g. "1" for spouse), so
   * this is normally unused — present for completeness / yes-no aliasing.
   */
  optionValue?: string;
  /** Present only when the input cannot be found by `name`. */
  locate?: LocateSpec;
}

export interface SetResult {
  name: string;
  success: boolean;
  message: string;
}
