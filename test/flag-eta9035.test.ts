// The ETA-9035 (H-1B LCA) descriptor, checked against the live capture it was
// authored from (test/fixtures/flag-lca-field-dump/eta9035-capture.json, a
// throwaway draft read on 2026-10-08) and against the backend table that sends
// its values. Both joins are asserted in both directions.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ETA9035_CONFIG,
  ETA9035_FORBIDDEN,
  ETA9035_NOT_AUTOFILLED,
  ETA9035_SECTIONS,
} from "../src/flag/eta9035-descriptor";
import { fillSection, isForbidden } from "../src/flag/fill-chain";
import { findSectionLink, sectionIsRendered } from "../src/flag/nav";
import { FLAG_CONFIGS, caseTypeMatchesForm, flagConfigForPath } from "../src/flag/registry";
import { FlagField, flagFieldNames } from "../src/flag/types";
import { locateElement } from "../src/engine/value-setter";

interface CapturedField {
  box: string;
  kind: string;
  name: string | null;
  id?: string | null;
  label?: string;
  values?: string[];
  revealedBy?: { by: string; is: string[] };
}

const CAPTURE = JSON.parse(
  readFileSync("test/fixtures/flag-lca-field-dump/eta9035-capture.json", "utf-8"),
) as {
  urlPattern: string;
  sidebar: string[];
  forbidden: { id?: string; text?: string }[];
  sections: Record<string, { nav: string; fields: CapturedField[] }>;
};

const TABLE = JSON.parse(
  readFileSync("test/fixtures/flag-perm-field-dump/flag_fields.json", "utf-8"),
) as {
  forms: Record<string, Record<string, { name: string; kind: string; label?: string; by_id?: boolean }>>;
};

const captured = (): CapturedField[] => Object.values(CAPTURE.sections).flatMap((s) => s.fields);
const fields = (): FlagField[] => ETA9035_SECTIONS.flatMap((s) => s.fields);

/** The handle a field is found by on the page: its name, its id, or its label. */
const capturedHandle = (f: CapturedField): string => f.name ?? f.id ?? f.label ?? f.box;
const fieldHandle = (f: FlagField): string => f.byLabel ?? f.name;

describe("descriptor vs the live capture", () => {
  it("drives no field the capture never saw", () => {
    const seen = new Set(captured().map(capturedHandle));
    expect(fields().map(fieldHandle).filter((h) => !seen.has(h))).toEqual([]);
  });

  it("drives every captured field except the deliberate exclusions", () => {
    const driven = new Set(fields().map(fieldHandle));
    const missing = captured()
      .filter((f) => !driven.has(capturedHandle(f)))
      .map((f) => f.box);
    // Phone country-code selects: no box sends one. F.12a: a lookup modal.
    expect(missing).toEqual(["C.10 country code", "D.12 country code", "E.12 country code", "F.12a"]);
  });

  it("carries every reveal the capture recorded, with FLAG's own values", () => {
    const want = captured()
      .filter((f) => f.revealedBy && f.name)
      .map((f) => [f.name, f.revealedBy!.by, f.revealedBy!.is.join("|")].join(" "));
    const ours = fields()
      .filter((f) => f.revealedBy)
      .map((f) => [f.name, f.revealedBy!.by, (f.revealedBy!.is ?? []).join("|")].join(" "));
    expect(ours.sort()).toEqual(want.sort());
  });

  it("lists each gate before the fields it reveals", () => {
    for (const section of ETA9035_SECTIONS) {
      const seen = new Set<string>();
      for (const field of section.fields) {
        if (field.revealedBy) expect(seen.has(field.revealedBy.by), field.name).toBe(true);
        seen.add(field.name);
      }
    }
  });

  it("navigates by the captured sidebar titles, and never to Review & Submit", () => {
    const sidebar = new Set(CAPTURE.sidebar);
    for (const section of ETA9035_SECTIONS) {
      expect([...sidebar].some((t) => t.includes(section.navLabel)), section.navLabel).toBe(true);
      expect(section.navLabel).not.toMatch(/review|submit/i);
    }
  });

  it("finds the county by id and the two comboboxes by label", () => {
    const county = fields().find((f) => f.name === "_section_f_f7_work_county_id")!;
    expect(county.byId).toBe(true);
    const soc = fields().find((f) => f.name === "b2_soc_code")!;
    expect(soc.byLabel).toBe("B.2/B.3. SOC (ONET/OES) Code and Occupation Title");
    expect(soc.kind).toBe("search");
    const naics = fields().find((f) => f.name === "c13_naics_code")!;
    expect(naics.byLabel).toBe("C.13. NAICS Code");
  });

  it("recognises a 9035 application URL from the capture's pattern, and nothing else", () => {
    const p = ETA9035_CONFIG.urlPattern;
    expect(p.test("/dashboard/application/9035/6ac7c38a36551c001c88422a")).toBe(true);
    expect(p.test("/dashboard/application/9141/6a831a2313a71d001e967db2")).toBe(false);
    expect(new RegExp(CAPTURE.urlPattern).test("https://flag.dol.gov/dashboard/application/9035/6ac7c38a36551c001c88422a")).toBe(true);
  });
});

describe("descriptor vs the backend table", () => {
  const table = TABLE.forms["ETA-9035E"];

  it("exists in the committed copy of the backend table", () => {
    expect(Object.keys(table).length).toBeGreaterThan(80);
  });

  it("drives every field the backend can send, except the refused attestations", () => {
    const driven = new Set(flagFieldNames(ETA9035_SECTIONS));
    const dropped = Object.values(table)
      .map((s) => s.name)
      .filter((n) => !driven.has(n) && !["g1_read_agree", "h6_read_agree"].includes(n));
    expect(dropped).toEqual([]);
  });

  it("drives no field the backend never sends", () => {
    const sent = new Set(Object.values(table).map((s) => s.name));
    expect(flagFieldNames(ETA9035_SECTIONS).filter((n) => !sent.has(n))).toEqual([]);
  });

  it("agrees with the backend on how each field is found and driven", () => {
    const byName = new Map(Object.values(table).map((s) => [s.name, s]));
    const wrong: string[] = [];
    for (const f of fields()) {
      const s = byName.get(f.name);
      if (!s) continue;
      const ours = f.kind === "search" && s.by_id ? "text" : f.kind;
      if (ours !== s.kind) wrong.push(`${f.name}: descriptor=${f.kind} backend=${s.kind}`);
      if ((f.byLabel ?? null) !== (s.label ?? null)) wrong.push(`${f.name}: label`);
      if (!!f.byId !== !!s.by_id) wrong.push(`${f.name}: by_id`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("refusals", () => {
  it("refuses all three profile pickers by the captured ids", () => {
    for (const id of ["employer-9035", "employer-pocs-9035", "agent-attorney-individs-9035"]) {
      expect(isForbidden({ name: id, kind: "search" }, ETA9035_FORBIDDEN), id).toBeTruthy();
    }
  });

  it("refuses the two attestations", () => {
    for (const name of ["g1_read_agree", "h6_read_agree"]) {
      expect(isForbidden({ name, kind: "radio" }, ETA9035_FORBIDDEN), name).toBeTruthy();
    }
  });

  it("carries every control the capture forbade", () => {
    const ours = ETA9035_FORBIDDEN.map((f) => f.match);
    for (const f of CAPTURE.forbidden) expect(ours).toContain(f.id ?? f.text);
  });

  it("does not refuse an ordinary field", () => {
    expect(isForbidden({ name: "c1_emp_name", kind: "text" }, ETA9035_FORBIDDEN)).toBeNull();
  });

  it("names what stays manual, with a reason", () => {
    const boxes = ETA9035_NOT_AUTOFILLED.map((f) => f.box);
    for (const box of ["F.12a", "F.13", "G.1", "H.6", "Appendix A"]) expect(boxes).toContain(box);
    for (const f of ETA9035_NOT_AUTOFILLED) expect(f.reason).toBeTruthy();
  });
});

// Shapes for the label locate. The real widget markup was not captured, so these
// cover the two common MUI shapes plus the failure cases that must stay closed.
const PICKER =
  '<div class="MuiFormControl-root"><label>Select an Employer profile to populate this section</label>' +
  '<div class="MuiAutocomplete-root"><input id="employer-9035" role="combobox" /></div></div>';
const NAICS =
  '<div class="MuiFormControl-root"><label>C.13. NAICS Code</label>' +
  '<div class="MuiAutocomplete-root"><input role="combobox" /></div></div>';

describe("locating a field by its box label", () => {
  const spec = { name: "c13_naics_code", kind: "search" as const, locate: { boxLabel: "C.13. NAICS Code" } };

  it("finds the one input in the label's own field", () => {
    document.body.innerHTML = PICKER + NAICS;
    const el = locateElement(spec);
    expect(el).not.toBeNull();
    expect(el!.id).not.toBe("employer-9035");
  });

  it("returns nothing when the label's field holds more than one input", () => {
    document.body.innerHTML =
      '<div><label>C.13. NAICS Code</label><input /><input /></div>';
    expect(locateElement(spec)).toBeNull();
  });

  it("returns nothing when two fields carry the label", () => {
    document.body.innerHTML = NAICS + NAICS;
    expect(locateElement(spec)).toBeNull();
  });

  it("does not match a different box that starts the same way", () => {
    document.body.innerHTML =
      '<div><label>C.1. Legal Business Name</label><input name="c1_emp_name" /></div>';
    expect(locateElement({ ...spec, locate: { boxLabel: "C.1. Legal" } })?.getAttribute("name")).toBe("c1_emp_name");
    expect(locateElement({ ...spec, locate: { boxLabel: "C.13. NAICS Code" } })).toBeNull();
  });

  it("lets the section be recognised by a label-only field", () => {
    document.body.innerHTML = NAICS;
    const section = { navLabel: "x", title: "x", fields: [{ name: "c13_naics_code", kind: "search" as const, byLabel: "C.13. NAICS Code" }] };
    expect(sectionIsRendered(section)).toBe(true);
  });

  it("refuses a label match that lands on a forbidden control", async () => {
    document.body.innerHTML =
      '<div><label>C.13. NAICS Code</label><input id="employer-9035" /></div>';
    const section = { navLabel: "x", title: "x", fields: [{ name: "c13_naics_code", kind: "search" as const, byLabel: "C.13. NAICS Code" }] };
    const out = await fillSection(section, { c13_naics_code: "541511" }, ETA9035_FORBIDDEN);
    expect(out[0].status).toBe("refused");
  });

  it("reports a missing label field as not rendered, not a fill into something else", async () => {
    document.body.innerHTML = PICKER;
    const section = { navLabel: "x", title: "x", fields: [{ name: "c13_naics_code", kind: "search" as const, byLabel: "C.13. NAICS Code" }] };
    const out = await fillSection(section, { c13_naics_code: "541511" }, ETA9035_FORBIDDEN);
    expect(out[0].status).toBe("not-rendered");
    expect(document.querySelector<HTMLInputElement>("#employer-9035")!.value).toBe("");
  });
});

describe("navigation", () => {
  it("picks section G, not the longer H title that contains it", () => {
    document.body.innerHTML = `<nav><ul>
      <li class="page-item">GEmployer Labor Condition Statements</li>
      <li class="page-item">HH-1B Additional Employer Labor Condition Statements</li>
    </ul></nav>`;
    const g = ETA9035_SECTIONS.find((s) => s.navLabel === "Employer Labor Condition Statements")!;
    expect(findSectionLink(g)?.textContent).toBe("GEmployer Labor Condition Statements");
  });
});

describe("registry", () => {
  it("routes a 9035 path to this descriptor", () => {
    expect(flagConfigForPath("/dashboard/application/9035/6ac7c38a36551c001c88422a")?.formType).toBe("ETA-9035E");
    expect(FLAG_CONFIGS).toContain(ETA9035_CONFIG);
  });

  it("offers H-1B cases only", () => {
    expect(caseTypeMatchesForm("H-1B-CAP", "ETA-9035E")).toBe(true);
    expect(caseTypeMatchesForm("H-1B-COS-F1", "ETA-9035E")).toBe(true);
    expect(caseTypeMatchesForm("PERM", "ETA-9035E")).toBe(false);
    expect(caseTypeMatchesForm("IR-1", "ETA-9035E")).toBe(false);
  });
});
