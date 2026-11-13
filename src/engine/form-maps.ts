// Form maps served by the backend (GET /forms/ext-maps/). They replace the
// built-in descriptors form by form, so a portal change ships as a backend
// change. Data only: page lists, box names and kinds, reveals, button words,
// waits. The built-in descriptors stay as the fallback for any form the
// backend leaves out, sends malformed, or when it cannot be reached.

import { FLAG_CONFIGS } from "../flag/registry";
import { FlagFormConfig } from "../flag/types";
import { FORM_CONFIGS } from "../runner/registry";
import { FormConfig } from "../runner/types";
import { applyTuning } from "./tuning";

export const MAPS_SCHEMA = 1;
export const MAPS_STORAGE_KEY = "formMaps";
export const MAPS_PATH = "/forms/ext-maps/";

export interface FormMapsPayload {
  schema: number;
  min_ext_version?: string;
  etag?: string;
  tuning?: Record<string, Record<string, unknown>>;
  forms: Record<string, Record<string, unknown>>;
}

export interface MapsStatus {
  applied: string[];
  rejected: string[];
  updateNeeded: boolean;
}

const BUILT_IN_MYUSCIS = [...FORM_CONFIGS];
const BUILT_IN_FLAG = [...FLAG_CONFIGS];

/** -1, 0 or 1 for dotted numeric versions ("0.10.10" > "0.10.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const namedFields = (v: unknown): boolean =>
  Array.isArray(v) && v.every((f) => isObj(f) && isStr(f.name) && isStr(f.kind));

function asMyuscisConfig(formType: string, raw: Record<string, unknown>): FormConfig | null {
  const pages = raw.pages;
  if (!isStr(raw.hostPath) || !isStr(raw.label) || !Array.isArray(pages) || !pages.length) return null;
  const pagesOk = pages.every(
    (p) => isObj(p) && isStr(p.slug) && typeof p.title === "string" && isStr(p.kind) && namedFields(p.fields),
  );
  if (!pagesOk) return null;
  return { ...(raw as unknown as FormConfig), formType };
}

function asFlagConfig(formType: string, raw: Record<string, unknown>): FlagFormConfig | null {
  const sections = raw.sections;
  if (!isStr(raw.urlPattern) || !Array.isArray(sections) || !sections.length) return null;
  if (!sections.every((s) => isObj(s) && isStr(s.title) && namedFields(s.fields))) return null;
  let urlPattern: RegExp;
  try {
    urlPattern = new RegExp(raw.urlPattern);
  } catch {
    return null;
  }
  return { ...(raw as unknown as FlagFormConfig), formType, urlPattern };
}

function replaceAll<T>(target: T[], next: T[]): void {
  target.splice(0, target.length, ...next);
}

function upsert<T extends { formType: string }>(list: T[], config: T): void {
  const i = list.findIndex((c) => c.formType === config.formType);
  if (i >= 0) list[i] = config;
  else list.push(config);
}

/** Back to the maps this build shipped with. */
export function resetFormMaps(): void {
  replaceAll(FORM_CONFIGS, BUILT_IN_MYUSCIS);
  replaceAll(FLAG_CONFIGS, BUILT_IN_FLAG);
  applyTuning({});
}

/**
 * Lay the backend's maps over the built-in ones. A payload this build cannot
 * read (newer schema, or a minimum version above this build) is ignored as a
 * whole and reported as `updateNeeded`.
 */
export function applyFormMaps(payload: unknown, extVersion: string): MapsStatus {
  resetFormMaps();
  const status: MapsStatus = { applied: [], rejected: [], updateNeeded: false };
  if (!isObj(payload) || !isObj(payload.forms)) return status;
  const p = payload as unknown as FormMapsPayload;
  if (p.schema !== MAPS_SCHEMA || (p.min_ext_version && compareVersions(extVersion, p.min_ext_version) < 0)) {
    status.updateNeeded = true;
    return status;
  }
  for (const [formType, raw] of Object.entries(p.forms)) {
    if (!isObj(raw)) {
      status.rejected.push(formType);
      continue;
    }
    if (raw.portal === "flag") {
      const config = asFlagConfig(formType, raw);
      if (config) upsert(FLAG_CONFIGS, config);
      (config ? status.applied : status.rejected).push(formType);
    } else {
      const config = asMyuscisConfig(formType, raw);
      if (config) upsert(FORM_CONFIGS, config);
      (config ? status.applied : status.rejected).push(formType);
    }
  }
  applyTuning(p.tuning);
  return status;
}

function extVersion(): string {
  return chrome.runtime.getManifest().version;
}

/** Apply the maps the popup last saved. Never throws; built-in maps on any failure. */
export async function loadFormMaps(): Promise<MapsStatus> {
  try {
    const stored = await chrome.storage.local.get(MAPS_STORAGE_KEY);
    return applyFormMaps(stored[MAPS_STORAGE_KEY], extVersion());
  } catch {
    resetFormMaps();
    return { applied: [], rejected: [], updateNeeded: false };
  }
}

/**
 * Fetch fresh maps and save them for the content scripts. `get` is the
 * caller's authenticated GET. Keeps the saved copy when the backend is down,
 * and drops it when the backend answers that it has none for this build.
 */
export async function refreshFormMaps(
  get: (path: string) => Promise<Response>,
): Promise<MapsStatus> {
  try {
    const stored = await chrome.storage.local.get(MAPS_STORAGE_KEY);
    const current = stored[MAPS_STORAGE_KEY] as FormMapsPayload | undefined;
    const have = current?.etag ? `?have=${encodeURIComponent(current.etag)}` : "";
    const res = await get(`${MAPS_PATH}${have}`);
    if (res.ok) {
      const body = await res.json();
      if (isObj(body) && body.unchanged === true) return loadFormMaps();
      await chrome.storage.local.set({ [MAPS_STORAGE_KEY]: body });
    } else if (res.status === 404) {
      await chrome.storage.local.remove(MAPS_STORAGE_KEY);
    }
  } catch {
    // Offline or signed out: keep whatever was saved last.
  }
  return loadFormMaps();
}
