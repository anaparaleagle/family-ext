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
   * The element's `id`, for an input that has an id but NO name attribute.
   *
   * The strongest strategy there is, and tried first: an id is a single element by
   * definition, so unlike an anchor walk or a label match it cannot land on
   * someone else's field. Added for the ETA-9141's worksite county
   * (`<input id="primaryWorksiteCounty">` with no name), which the H-1B extension
   * had to pin the same way on the LCA — and which decides the prevailing-wage
   * area, so a wrong element there is a wrong wage.
   */
  id?: string;
  /**
   * The name of a nearby field whose name IS stable. The element is found as the
   * next same-type input after that anchor, within the anchor's own field group.
   *
   * Preferred over `labelContains`: an anchor name is something verified from a
   * live capture, whereas label text is derived and likelier to drift.
   */
  nearName?: string;
  /**
   * A fragment of the field's name, matched case-insensitively with
   * `[name*="..." i]`. For RADIO GROUPS whose Formik path myUSCIS has renamed.
   *
   * The OEWS wage-level group is the reason: its path moved out of
   * `numericalLimitationInformation` and the H-1B extension had to stop naming it
   * outright, reaching it by the surviving "wageLevel" token instead. A radio
   * resolves by (name, option) across a whole group, so it cannot use `id` or
   * `nearName` — those find one element, not the group.
   */
  nameContains?: string;
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
