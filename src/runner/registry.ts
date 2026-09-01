// The FORM CONFIG REGISTRY — the one place that knows which guided online forms
// this extension drives, and how to recognize each one from the URL.
//
// Adding a form is: author its descriptor under src/<form>/form-descriptor.ts,
// then add one entry here. Nothing else in the runner changes.

import { I129_PAGES } from "../i129/form-descriptor";
import { I130_PAGES } from "../i130/form-descriptor";
import { I539_PAGES } from "../i539/form-descriptor";
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

export const FORM_CONFIGS: FormConfig[] = [
  I130_CONFIG,
  I539_CONFIG,
  N400_CONFIG,
  I129_CONFIG,
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
