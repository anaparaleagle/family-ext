// Cross-check the extension structural descriptor against the backend value map
// (form_myuscis_definitions.json) and the live field dump. This guards the seam:
// every field-name the backend will EMIT must be one the descriptor knows how to
// fill, and the descriptor must not invent names the backend never sends.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { descriptorFieldNames } from "../src/i130/form-descriptor";

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);
const FIELD_DUMP = resolve(__dirname, "../../i130-online-field-dump.json");

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

describe("descriptor <-> backend value map", () => {
  const descriptor = new Set(descriptorFieldNames());
  const { mapped, repeaterRow0 } = loadBackendNames();

  it("every backend-mapped field name is in the descriptor", () => {
    const missing = mapped.filter((n) => !descriptor.has(n));
    expect(missing, `descriptor missing backend names: ${missing.join(", ")}`).toEqual([]);
  });

  it("every backend repeater row-0 name is in the descriptor", () => {
    const missing = repeaterRow0.filter((n) => !descriptor.has(n));
    expect(missing, `descriptor missing repeater names: ${missing.join(", ")}`).toEqual([]);
  });

  it("drives the six gating '.none' toggles it used to skip (SOF-755)", () => {
    // The I-130 had the same latent stall as the I-539: a blank A-Number / SSN /
    // USCIS# on either the applicant.* (petitioner) or beneficiary.* side left the
    // "...none" gate unchecked and Next disabled. These moved out of the backend
    // `skip` into the value map (checked when the fact is blank), so they must now
    // be BOTH backend-mapped and descriptor-driven.
    const gating = [
      "formikFactoryUIMeta.applicant.additionalInformation.alienNumber.none",
      "formikFactoryUIMeta.applicant.additionalInformation.uscisNumber.none",
      "formikFactoryUIMeta.applicant.additionalInformation.socialSecurityNumber.none",
      "formikFactoryUIMeta.beneficiary.additionalInformation.alienNumber.none",
      "formikFactoryUIMeta.beneficiary.additionalInformation.uscisNumber.none",
      "formikFactoryUIMeta.beneficiary.additionalInformation.socialSecurityNumber.none",
    ];
    const mappedSet = new Set(mapped);
    for (const name of gating) {
      expect(mappedSet.has(name), `${name} must be backend-mapped`).toBe(true);
      expect(descriptor.has(name), `${name} must be descriptor-driven`).toBe(true);
    }
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

describe("descriptor <-> live field dump", () => {
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
