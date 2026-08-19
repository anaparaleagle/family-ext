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

/**
 * Case type codes a form applies to, or null when it applies to any of them.
 *
 * Null for every myUSCIS form, and that is not an oversight: an I-130 or an
 * N-400 can legitimately sit on several family case types, and narrowing that
 * list from here would hide cases a caseworker actually needs. The DOL forms are
 * the opposite — the ETA-9141 belongs to PERM and nothing else, and the backend
 * will 400 on anything else, so showing the rest is offering a dead end.
 */
export function caseTypesForForm(formType: string): string[] | null {
  return FLAG_CONFIGS.find((c) => c.formType === formType)?.caseTypes ?? null;
}

/** Does `caseType` match what `formType` accepts? Unknown/absent type = show it. */
export function caseTypeMatchesForm(
  caseType: string | undefined,
  formType: string,
): boolean {
  const allowed = caseTypesForForm(formType);
  if (!allowed) return true;
  // A row with no case_type is shown rather than hidden. The list endpoint
  // always sends one, so this only fires if the contract changes — and a filter
  // that silently empties the list on a rename is worse than one that shows too
  // much.
  if (!caseType) return true;
  return allowed.includes(caseType);
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
