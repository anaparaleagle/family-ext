// Which cases the popup may offer for a given form.
//
// The rule that earns a test: EB-2-PERM is NOT PERM. It is a separate,
// pre-existing case type, and the backend's ETA endpoints reject it by name with
// a 400. A "contains PERM" filter would list those cases, the caseworker would
// pick one, and the error would read as the extension being broken rather than
// as the wrong case.

import { describe, it, expect } from "vitest";
import {
  FLAG_CONFIGS,
  caseTypeMatchesForm,
  caseTypesForForm,
} from "../src/flag/registry";

describe("case types a form accepts", () => {
  it("restricts the ETA-9141 to PERM", () => {
    expect(caseTypesForForm("ETA-9141")).toEqual(["PERM"]);
  });

  it("does not restrict the myUSCIS forms", () => {
    // Null means "no filter", and that is deliberate: an I-130 or an N-400 sits
    // on several family case types, so narrowing the list from the extension
    // would hide cases a caseworker needs.
    for (const formType of ["I-130", "I-539", "N-400"]) {
      expect(caseTypesForForm(formType)).toBeNull();
    }
  });

  it("gives every DOL form a case-type list", () => {
    // A new FLAG form added without one would silently fall back to "show
    // everything", which is the behaviour this whole filter exists to remove.
    for (const config of FLAG_CONFIGS) {
      expect(config.caseTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("matching a case against a form", () => {
  it("accepts a PERM case for the ETA-9141", () => {
    expect(caseTypeMatchesForm("PERM", "ETA-9141")).toBe(true);
  });

  it("REJECTS EB-2-PERM, which is a different case type", () => {
    expect(caseTypeMatchesForm("EB-2-PERM", "ETA-9141")).toBe(false);
  });

  it("rejects the family and I-140 case types", () => {
    for (const code of ["IR-1", "I-140", "N-400", "I-539"]) {
      expect(caseTypeMatchesForm(code, "ETA-9141")).toBe(false);
    }
  });

  it("accepts anything for a myUSCIS form", () => {
    for (const code of ["IR-1", "PERM", "I-140"]) {
      expect(caseTypeMatchesForm(code, "I-130")).toBe(true);
    }
  });

  it("shows a case whose type is missing rather than hiding it", () => {
    // The list endpoint always sends case_type, so this only fires if that
    // contract changes. A filter that silently empties the list on a field
    // rename is worse than one that shows too much.
    expect(caseTypeMatchesForm(undefined, "ETA-9141")).toBe(true);
    expect(caseTypeMatchesForm("", "ETA-9141")).toBe(true);
  });

  it("does not match on substring or case", () => {
    expect(caseTypeMatchesForm("perm", "ETA-9141")).toBe(false);
    expect(caseTypeMatchesForm("PERM-2", "ETA-9141")).toBe(false);
  });
});
