// Cross-check the extension structural descriptor against the backend value map
// (form_myuscis_definitions.json) and the live field dump. This guards the seam:
// every field-name the backend will EMIT must be one the descriptor knows how to
// fill, and the descriptor must not invent names the backend never sends.

import { beforeAll, describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { descriptorFieldNames } from "../src/i130/form-descriptor";

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);
const FIELD_DUMP = resolve(__dirname, "../../i130-online-field-dump.json");

// The backend map lives in a SIBLING REPO, so it is only present when that repo is
// checked out beside this one — the local dev layout, and in CI only when the
// FAMILY_BACKEND_TOKEN secret is set (see .github/workflows/ci.yml). Without it this
// guard self-skips instead of failing the run: a missing secret should degrade
// coverage, not block every PR. Note `loadBackendNames()` is called in the describe
// BODY, so an absent file throws at COLLECTION and takes the whole file down —
// hence the skipIf on the describe rather than on the individual tests.
const HAVE_BACKEND_MAP = existsSync(BACKEND_MAP);

function loadBackendNames(): { mapped: string[]; repeaterRow0: string[] } {
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const def = json["IR-1"].definitions["I-130"];
  const mapped = Object.keys(def.field_to_factkey_map);
  const repeaterRow0: string[] = [];
  for (const block of Object.values<any>(def.repeaters)) {
    for (const tmpl of Object.keys(block.row_map)) {
      repeaterRow0.push(tmpl.replace(/\{i\}/g, "0"));
    }
  }
  return { mapped, repeaterRow0 };
}

describe.skipIf(!HAVE_BACKEND_MAP)("descriptor <-> backend value map", () => {
  const descriptor = new Set(descriptorFieldNames());
  // Loaded in beforeAll, NOT in the describe body: `skipIf` skips the tests but
  // still RUNS the body, so an eager read here would throw at collection and take
  // the whole file down even when the guard is meant to be skipped. beforeAll does
  // not run for a skipped describe.
  let mapped: string[] = [];
  let repeaterRow0: string[] = [];
  beforeAll(() => {
    ({ mapped, repeaterRow0 } = loadBackendNames());
  });

  it("every backend-mapped field name is in the descriptor", () => {
    const missing = mapped.filter((n) => !descriptor.has(n));
    expect(missing, `descriptor missing backend names: ${missing.join(", ")}`).toEqual([]);
  });

  it("every backend repeater row-0 name is in the descriptor", () => {
    const missing = repeaterRow0.filter((n) => !descriptor.has(n));
    expect(missing, `descriptor missing repeater names: ${missing.join(", ")}`).toEqual([]);
  });

  it("reports descriptor coverage of the backend payload (informational)", () => {
    const backendAll = new Set([...mapped, ...repeaterRow0]);
    const driven = [...backendAll].filter((n) => descriptor.has(n));
    // The descriptor must drive 100% of what the backend can emit.
    expect(driven.length).toBe(backendAll.size);
    // eslint-disable-next-line no-console
    console.log(
      `Descriptor drives ${descriptor.size} distinct fields; ` +
        `backend emits ${backendAll.size} mapped names, all covered.`,
    );
  });
});

// The I-130 live capture (i130-online-field-dump.json) is MISSING — it is not in
// this repo, not in the backend repo, and not on the machine the I-130 map was
// built from. So this guard cannot run anywhere today; it is skipped rather than
// left as a permanent red that trains everyone to ignore CI. The I-539 analogue in
// i539-coverage.test.ts IS vendored (test/fixtures/) and does run.
// To restore this: re-capture the online I-130 and vendor the dump beside the
// I-539 one, then drop the existsSync guard.
// Needs the backend map too (it reads both), so it requires both to be present.
const HAVE_I130_DUMP = existsSync(FIELD_DUMP);

describe.skipIf(!HAVE_I130_DUMP || !HAVE_BACKEND_MAP)("descriptor <-> live field dump", () => {
  it("accounts for every fillable dump field (mapped, skipped, or upload)", () => {
    const dump = JSON.parse(readFileSync(FIELD_DUMP, "utf-8"));
    const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
    const def = json["IR-1"].definitions["I-130"];

    const known = new Set<string>([
      ...Object.keys(def.field_to_factkey_map),
      ...def.skip,
    ]);
    // Repeater names appear in the dump only at index 0; add row-0 templates.
    for (const block of Object.values<any>(def.repeaters)) {
      for (const tmpl of Object.keys(block.row_map)) known.add(tmpl.replace(/\{i\}/g, "0"));
    }

    const dumpNames: string[] = [];
    for (const section of Object.values<any>(dump.sidebar_sections)) {
      for (const pageObj of section) {
        for (const f of pageObj.fields) dumpNames.push(f.name);
      }
    }

    const unaccounted = dumpNames.filter((n) => !known.has(n));
    expect(
      unaccounted,
      `dump fields neither mapped nor skipped: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });
});
