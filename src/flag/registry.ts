// The FLAG form registry — the one place that knows which DOL forms this
// extension drives, and the storage keys their payload lives under.
//
// Kept SIDE-EFFECT-FREE and separate from the descriptors' own module so the
// popup can import it without pulling a content script's imports into the popup
// bundle.

import { ETA9141_CONFIG } from "./eta9141-descriptor";
import { FlagFormConfig } from "./types";

export const FLAG_CONFIGS: FlagFormConfig[] = [ETA9141_CONFIG];

/**
 * Storage keys for the FLAG side.
 *
 * Deliberately NOT the myUSCIS `myuscis*` keys. The two payloads are keyed by
 * different vocabularies — Formik paths on one portal, FLAG DOM names on the
 * other — so a payload loaded for one form can never fill the other. Sharing a
 * key would mean an ETA-9141 load silently replacing a loaded I-130, and the
 * symptom would be a walk that reports 0 filled on every page with no
 * explanation.
 */
export const FLAG_KEYS = {
  fieldValues: "flagFieldValues",
  formType: "flagFormType",
  caseId: "flagCaseId",
  loadedAt: "flagLoadedAt",
} as const;

/** Is this form code one of the DOL forms (as opposed to a myUSCIS one)? */
export function isFlagForm(formType: string): boolean {
  return FLAG_CONFIGS.some((c) => c.formType === formType);
}

/** The autofill feed path for a DOL form. */
export function autofillPath(caseId: string, formType: string): string {
  return (
    `/forms/eta-autofill/${encodeURIComponent(caseId)}/` +
    `?form=${encodeURIComponent(formType)}`
  );
}

export function flagConfigForPath(pathname: string): FlagFormConfig | null {
  return FLAG_CONFIGS.find((c) => c.urlPattern.test(pathname)) ?? null;
}
