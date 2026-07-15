// The FORM CONFIG REGISTRY — the one place that knows which guided online forms
// this extension drives, and how to recognize each one from the URL.
//
// Adding a form is: author its descriptor under src/<form>/form-descriptor.ts,
// then add one entry here. Nothing else in the runner changes.

import { I130_PAGES } from "../i130/form-descriptor";
import { I539_PAGES } from "../i539/form-descriptor";
import { FormConfig } from "./types";

export const I130_CONFIG: FormConfig = {
  formType: "I-130",
  hostPath: "/forms/petition-for-a-relative/",
  label: "ParaLeagle I-130",
  pages: I130_PAGES,
};

export const I539_CONFIG: FormConfig = {
  formType: "I-539",
  hostPath: "/forms/application-to-extend-change-nonimmigrant-status/",
  label: "ParaLeagle I-539",
  pages: I539_PAGES,
};

export const FORM_CONFIGS: FormConfig[] = [I130_CONFIG, I539_CONFIG];

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
