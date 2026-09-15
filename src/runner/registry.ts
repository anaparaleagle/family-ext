// The FORM CONFIG REGISTRY — the one place that knows which guided online forms
// this extension drives, and how to recognize each one from the URL.
//
// Adding a form is: author its descriptor under src/<form>/form-descriptor.ts,
// then add one entry here. Nothing else in the runner changes.

import { I129_PAGES } from "../i129/form-descriptor";
import { I130_PAGES } from "../i130/form-descriptor";
import { I131_PAGES } from "../i131/form-descriptor";
import { I485_PAGES } from "../i485/form-descriptor";
import { I539_PAGES } from "../i539/form-descriptor";
import { I765_PAGES } from "../i765/form-descriptor";
import { N400_PAGES } from "../n400/form-descriptor";
import { FormConfig } from "./types";

export const I130_CONFIG: FormConfig = {
  formType: "I-130",
  hostPath: "/forms/petition-for-a-relative/",
  label: "ParaLeagle I-130",
  pages: I130_PAGES,
  caseTypes: ["IR-1", "IR-2", "IR-5"],
};

export const I539_CONFIG: FormConfig = {
  formType: "I-539",
  hostPath: "/forms/application-to-extend-change-nonimmigrant-status/",
  label: "ParaLeagle I-539",
  pages: I539_PAGES,
  caseTypes: [
    "I-539-STUDENT",
    "I-539-VISITOR",
    "I-539-STUDENT-DEP",
    "I-539-EXCHANGE",
    "I-539-EXCHANGE-DEP",
    "I-539-WORKER-DEP",
    "I-539-SPECIAL",
  ],
};

export const N400_CONFIG: FormConfig = {
  formType: "N-400",
  hostPath: "/forms/application-for-naturalization/",
  label: "ParaLeagle N-400",
  pages: N400_PAGES,
  caseTypes: ["N-400"],
};

export const I129_CONFIG: FormConfig = {
  formType: "I-129",
  hostPath: "/forms/petition-for-a-nonimmigrant-worker/",
  label: "ParaLeagle I-129",
  pages: I129_PAGES,
  // The six cap-exempt H-1B change-of-status types. All six share ONE backend
  // map via `definitions_from` aliases, exactly like the seven I-539 groups.
  caseTypes: [
    "H-1B-COS-F1",
    "H-1B-COS-F2",
    "H-1B-COS-J2",
    "H-1B-COS-H4",
    "H-1B-COS-L2",
    "H-1B-COS-L1",
  ],
};

export const I765_CONFIG: FormConfig = {
  formType: "I-765",
  // USCIS "PDF Intake" (BETA) — a different host path SHAPE from the guided
  // forms (/pdf-intake/<form>/<draftUuid>/<slug>, not /forms/<name>/…).
  hostPath: "/pdf-intake/I-765/",
  label: "ParaLeagle I-765",
  pages: I765_PAGES,
  // The SAME IR types as the I-130, on purpose: the C9 pending-I-485 EAD is
  // filed for the beneficiary of the family petition. formTypeForCaseType reads
  // the FIRST match, and the I-130 stays first — the petition remains what the
  // picker auto-follows, and filling the I-765 stays a manual form choice.
  // PDF Intake cannot serve the OPT (c)(3) or H-4 (c)(26) I-765 case types —
  // its eligibility dropdown simply does not offer those categories.
  caseTypes: ["IR-1", "IR-2", "IR-5"],
};

export const I485_CONFIG: FormConfig = {
  formType: "I-485",
  hostPath: "/pdf-intake/I-485/",
  label: "ParaLeagle I-485",
  pages: I485_PAGES,
  // Same IR types as the I-130 and the I-765; the I-130 stays first so the
  // picker keeps auto-following the petition.
  caseTypes: ["IR-1", "IR-2", "IR-5"],
};

export const I131_CONFIG: FormConfig = {
  formType: "I-131",
  hostPath: "/pdf-intake/I-131/",
  label: "ParaLeagle I-131",
  pages: I131_PAGES,
  // The advance-parole travel document filed alongside a pending I-485. Same IR
  // types as the rest of the bundle; the I-130 stays first in the list so the
  // picker keeps auto-following the petition.
  caseTypes: ["IR-1", "IR-2", "IR-5"],
};

export const FORM_CONFIGS: FormConfig[] = [
  I130_CONFIG,
  I539_CONFIG,
  N400_CONFIG,
  I129_CONFIG,
  I765_CONFIG,
  I485_CONFIG,
  I131_CONFIG,
];

/**
 * Pick the config for a myUSCIS path, or null when the path is not one of our
 * forms (an account page, the dashboard, another form entirely). The host paths
 * are disjoint, so first match wins.
 */
export function configForPath(pathname: string): FormConfig | null {
  return FORM_CONFIGS.find((c) => pathname.includes(c.hostPath)) ?? null;
}

/** Look up a config by backend form_type (what the popup requests). */
export function configForFormType(formType: string): FormConfig | null {
  return FORM_CONFIGS.find((c) => c.formType === formType) ?? null;
}

/**
 * The form a case type is filed on, or null when no online form covers it.
 *
 * Null is "leave the picker alone", not "pick the first one": an EB or PERM case
 * has no myUSCIS form here, and swapping the caseworker's choice out from under
 * them would be worse than leaving it.
 */
export function formTypeForCaseType(caseType: string | undefined): string | null {
  if (!caseType) return null;
  return FORM_CONFIGS.find((c) => c.caseTypes?.includes(caseType))?.formType ?? null;
}
