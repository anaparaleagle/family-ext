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
import { FlagField, flagFieldNames, revealGates } from "../src/flag/types";
import { asDollarsAndCents, locateElement, sameMoney } from "../src/engine/value-setter";
import { readFlagValue } from "../src/flag/review";
import { mountCurrencyBox } from "./fixtures/dom";

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
      .flatMap((f) => revealGates(f).map((g) => [f.name, g.by, (g.is ?? []).join("|")].join(" ")));
    // Every captured reveal must still be carried. The descriptor may hold MORE
    // than the capture saw — a capture is one session on one draft, not the
    // form's rulebook — but each extra gate has to name its `source`, so the
    // difference between "watched it happen" and "guessed" stays on the page.
    const extra = fields().flatMap((f) =>
      revealGates(f)
        .filter((g) => !want.includes([f.name, g.by, (g.is ?? []).join("|")].join(" ")))
        .map((g) => ({ field: f.name, gate: g.by, source: g.source })),
    );
    expect(extra).toEqual([
      {
        field: "h3_only_h1b",
        gate: "h2_is_willful_violator",
        source: expect.stringContaining("Observed live"),
      },
    ]);
    expect(ours.filter((r) => want.includes(r)).sort()).toEqual(want.sort());
  });

  it("reveals H.3 on the willful-violator answer as well as the dependency one", () => {
    // DOL: "If Yes to H.1 and/or H.2". A willful violator that is NOT H-1B
    // dependent sees H.3, and the backend sends it — so gating on H.1 alone
    // left a required box blank and the section unsaveable.
    const h3 = fields().find((f) => f.name === "h3_only_h1b")!;
    expect(revealGates(h3).map((g) => g.by)).toEqual([
      "h1_is_dependent",
      "h2_is_willful_violator",
    ]);
    for (const gate of revealGates(h3)) expect(gate.is).toEqual(["YES"]);
  });

  it("lists each gate before the fields it reveals", () => {
    for (const section of ETA9035_SECTIONS) {
      const seen = new Set<string>();
      for (const field of section.fields) {
        for (const gate of revealGates(field)) expect(seen.has(gate.by), field.name).toBe(true);
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
      // The backend table describes the BOX; `kind` here is how the extension
      // writes it. Two of ours are a write strategy over a box the backend
      // rightly calls text: the by-id county typeahead, and the wage boxes,
      // whose mask needs one native write and a numeric read-back.
      const ours =
        (f.kind === "search" && s.by_id) || f.kind === "currency" ? "text" : f.kind;
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

describe("Section H when the employer is a willful violator but not dependent", () => {
  // The case SOF-2300 created. Until the employer record carried the question,
  // H.2 was always No and H.1 was the only gate anyone could see fire — so the
  // descriptor gated H.3 on H.1 alone and this whole branch was dead code. It
  // is not dead now: the backend derives H.3 = Yes whenever H.1 OR H.2 is Yes,
  // and sends the exemption basis with it.
  const section = ETA9035_SECTIONS.find((s) => s.title.startsWith("H —"))!;

  // What the feed sends for that employer, verbatim from the backend.
  const WILLFUL_ONLY = {
    h1_is_dependent: "NO",
    h2_is_willful_violator: "YES",
    h3_only_h1b: "YES",
    h4_exemption_basis: "$60,000 or higher annual wage",
  };

  const radios = (...names: string[]): string =>
    names
      .map((n) =>
        ["YES", "NO", "$60,000 or higher annual wage"]
          .map((v) => `<input type="radio" name="${n}" value="${v}" />`)
          .join(""),
      )
      .join("");

  /**
   * Section H as FLAG actually serves it: H.3 and H.4 are NOT on the page until
   * their gate is answered, and each arrives A TICK LATER, not in the same turn
   * as the click. FLAG is React — answering H.2 schedules a re-render, it does
   * not perform one — so the chain looks for H.3 and finds nothing there yet.
   *
   * Both halves of that matter. Pre-rendering the fields would make these tests
   * pass against the very bug they exist for, since `fillSection` consults a
   * gate only for a field the DOM does not already hold. Revealing them
   * synchronously does the same thing more subtly: the field would be in place
   * before the chain ever looked, and the gate would again go unread.
   */
  const REPAINT_MS = 20;

  const revealingPage = (): void => {
    document.body.innerHTML = radios("h1_is_dependent", "h2_is_willful_violator");
    const appearLater = (name: string) => {
      setTimeout(() => {
        if (!document.querySelector(`[name="${name}"]`)) {
          document.body.insertAdjacentHTML("beforeend", radios(name));
        }
      }, REPAINT_MS);
    };
    document.body.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.value !== "YES") return;
      if (el.name === "h1_is_dependent" || el.name === "h2_is_willful_violator") {
        appearLater("h3_only_h1b");
      }
      if (el.name === "h3_only_h1b") appearLater("h4_exemption_basis");
    });
  };

  it("types H.3, instead of skipping it as hidden", async () => {
    revealingPage();
    const out = await fillSection(section, WILLFUL_ONLY, ETA9035_FORBIDDEN);
    const h3 = out.find((o) => o.name === "h3_only_h1b")!;
    expect(h3.status).toBe("filled");
    expect(out.filter((o) => o.status === "failed")).toEqual([]);
  });

  it("does not then report H.4 as a broken reveal", async () => {
    // The old failure mode's second half: H.3 was skipped silently, so FLAG
    // never rendered H.4, and H.4 — whose own gate WAS answered — came back
    // "answered but this never appeared", pointing at a redesign that had not
    // happened.
    revealingPage();
    const out = await fillSection(section, WILLFUL_ONLY, ETA9035_FORBIDDEN);
    expect(out.find((o) => o.name === "h4_exemption_basis")?.status).toBe("filled");
  });

  it("still says nothing about H.3 when neither gate is Yes", async () => {
    // The ordinary employer, which is nearly all of them. H.3 genuinely never
    // renders, the backend sends nothing for it, and a silent skip is right.
    document.body.innerHTML = radios("h1_is_dependent", "h2_is_willful_violator");
    const out = await fillSection(
      section, { h1_is_dependent: "NO", h2_is_willful_violator: "NO" }, ETA9035_FORBIDDEN,
    );
    expect(out.find((o) => o.name === "h3_only_h1b")?.status).toBe("no-value");
    expect(out.filter((o) => o.status === "failed")).toEqual([]);
  });

  it("names both gates when it does report H.3 as hidden", async () => {
    // A message naming only H.1 is what sent this the wrong way the first time.
    document.body.innerHTML = radios("h1_is_dependent", "h2_is_willful_violator");
    const out = await fillSection(
      section,
      { h1_is_dependent: "NO", h2_is_willful_violator: "NO", h3_only_h1b: "YES" },
      ETA9035_FORBIDDEN,
    );
    const h3 = out.find((o) => o.name === "h3_only_h1b")!;
    expect(h3.status).toBe("not-rendered");
    expect(h3.message).toContain("h1_is_dependent or h2_is_willful_violator");
  });
});

describe("Section F wage boxes, against FLAG's currency mask", () => {
  // The live failure (FAM-4063, 2026-10-26): "10 filled, 3 failed
  // (_section_f_f10_nonimmigrant_wage_from, _section_f_f10_nonimmigrant_wage_to,
  // _section_f_f11_prevailing_wage)", with F.10 and F.11 blank on screen. The
  // feed was correct — plain digits, "110344" for all three.
  //
  // Two faults, and the first caused the second. Driven as plain text the
  // native write DID land ("$110,344.00"), but the read-back compares digits,
  // the mask's ".00" makes those "11034400", and so a good write was called a
  // failure. The waterfall then ran its last resort, which clears the box and
  // types one character at a time — and a two-decimal mask discards every one
  // after the first, leaving $1.00.
  const section = ETA9035_SECTIONS.find((s) => s.title.startsWith("F —"))!;
  const WAGE = "110344";
  const WAGE_BOXES = [
    "_section_f_f10_nonimmigrant_wage_from",
    "_section_f_f10_nonimmigrant_wage_to",
    "_section_f_f11_prevailing_wage",
  ];

  const mountWageBoxes = (opts: { disabled?: boolean } = {}) => {
    document.body.innerHTML = "";
    return WAGE_BOXES.map((n) => mountCurrencyBox(n, opts));
  };

  const fillWages = () =>
    fillSection(section, Object.fromEntries(WAGE_BOXES.map((n) => [n, WAGE])), ETA9035_FORBIDDEN);

  it("is declared as money, not as text", () => {
    for (const name of WAGE_BOXES) {
      expect(section.fields.find((f) => f.name === name)?.kind, name).toBe("currency");
    }
  });

  it("leaves the right wage in all three boxes", async () => {
    const boxes = mountWageBoxes();
    await fillWages();
    for (const b of boxes) expect(b.input.value).toBe("$110,344.00");
  });

  it("reports them as filled rather than as a false failure", async () => {
    mountWageBoxes();
    const out = await fillWages();
    expect(out.filter((o) => o.status === "failed").map((o) => o.name)).toEqual([]);
    for (const name of WAGE_BOXES) {
      expect(out.find((o) => o.name === name)?.status, name).toBe("filled");
    }
  });

  it("writes each box once, so no retry can type on top of the mask's output", async () => {
    // The $1.00 came from a second pass, not the first. One write is the fix.
    const boxes = mountWageBoxes();
    await fillWages();
    for (const b of boxes) expect(b.writes).toEqual(["110344.00"]);
  });

  it("spells the cents out, for a mask that would read bare digits as cents", async () => {
    const boxes = mountWageBoxes();
    await fillWages();
    expect(boxes[0].writes[0]).toBe("110344.00");
  });

  it("does not report a fill into a box FLAG has disabled", async () => {
    // F.11 is disabled and owned by the OES calculator whenever the prevailing
    // wage source is OES. A native assignment sticks even on a disabled input,
    // so without this guard the walk would claim a wage the page never took.
    const boxes = mountWageBoxes({ disabled: true });
    const out = await fillWages();
    expect(out.filter((o) => o.status === "filled")).toEqual([]);
    for (const b of boxes) expect(b.input.value).toBe("");
  });

  it("still fills a wage box that carries no mask at all", async () => {
    // Drift insurance: if DOL ever drops the mask, the amount must still land.
    document.body.innerHTML = WAGE_BOXES.map((n) => `<input type="text" name="${n}" />`).join("");
    const out = await fillWages();
    expect(out.filter((o) => WAGE_BOXES.includes(o.name) && o.status !== "filled")).toEqual([]);
    const el = document.querySelector<HTMLInputElement>(`[name="${WAGE_BOXES[0]}"]`)!;
    expect(el.value).toBe("110344.00");
  });
});

describe("reading a wage back for the sign-off compare", () => {
  it("reads the masked spelling, which the backend normalizes to the same wage", async () => {
    // readFlagValue is what the LCA summary review POSTs. It must not be
    // confused by the "$110,344.00" the mask renders — the backend's currency
    // normalizer (family_visa/cases/lca_summary_compare.py) parses both sides
    // as numbers, so "$110,344.00" and "110344" compare equal.
    document.body.innerHTML = "";
    const box = mountCurrencyBox("_section_f_f10_nonimmigrant_wage_from");
    await fillSection(
      ETA9035_SECTIONS.find((s) => s.title.startsWith("F —"))!,
      { _section_f_f10_nonimmigrant_wage_from: "110344" },
      ETA9035_FORBIDDEN,
    );
    expect(readFlagValue({ name: box.input.name, kind: "currency" })).toBe("$110,344.00");
    expect(sameMoney("$110,344.00", "110344")).toBe(true);
  });
});

describe("the money normalizer", () => {
  it("spells plain digits as dollars and cents", () => {
    expect(asDollarsAndCents("110344")).toBe("110344.00");
  });

  it("keeps cents it was given, and pads a single one", () => {
    expect(asDollarsAndCents("50.84")).toBe("50.84");
    expect(asDollarsAndCents("50.8")).toBe("50.80");
  });

  it("takes an already-formatted amount back apart", () => {
    expect(asDollarsAndCents("$110,344.00")).toBe("110344.00");
  });

  it("has nothing to write for an empty amount", () => {
    expect(asDollarsAndCents("")).toBe("");
    expect(asDollarsAndCents("$")).toBe("");
  });

  it("agrees that the mask's spelling is the same wage", () => {
    expect(sameMoney("$110,344.00", "110344")).toBe(true);
    expect(sameMoney("$110,344.00", "110344.00")).toBe(true);
    expect(sameMoney("$1.00", "110344")).toBe(false);
    expect(sameMoney("", "110344")).toBe(false);
  });
});
