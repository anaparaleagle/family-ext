// Section F of the ETA-9035E end to end: the OES Wage Calculator, and the
// "Add Place of Employment" button that is the only thing that turns a typed
// worksite into a row FLAG will keep.
//
// Both were missing, and both come from the H-1B extension's own Section F path
// (paraleagle-ext, src/content/lca-filler.ts `fillSectionF`), which drove this
// form in production for years. What is reproduced in the fixtures is the
// BEHAVIOUR that path depended on, plus what Varis read off the live page on
// 2026-10-27 — the yellow "your changes will be lost" banner, the greyed Add
// button, and the "0 Entries for Place of Employment" table.

import { describe, it, expect, beforeEach } from "vitest";
import {
  ETA9035_FORBIDDEN,
  ETA9035_NOT_AUTOFILLED,
  ETA9035_SECTIONS,
  OES_WAGE_CALCULATOR,
} from "../src/flag/eta9035-descriptor";
import { fillSection, isForbidden, runSection } from "../src/flag/fill-chain";
import { commitRepeaterRow, findButtonByText, repeaterRowCount } from "../src/flag/nav";
import { runModal } from "../src/flag/modal";
import { FlagSection } from "../src/flag/types";
import { mountCurrencyBox, mountOesCalculator, mountWorksiteRepeater } from "./fixtures/dom";

const SECTION_F = ETA9035_SECTIONS.find((s) => s.title.startsWith("F —"))!;
const PW_SOURCE = "_section_f_f12_f13_f14_prevailing_wage_question";
const OES = "f13_is_oes_prevailing_wage";
const PWD = "f12_is_dol_prevailing_wage";
const REPEATER = SECTION_F.repeater!;

beforeEach(() => {
  document.body.innerHTML = "";
});

const radios = (name: string, values: string[]): string =>
  values
    .map(
      (v, i) =>
        `<label for="${name}__${i}">${v}` +
        `<input type="radio" name="${name}" id="${name}__${i}" value="${v}" /></label>`,
    )
    .join("");

// ── the repeater ───────────────────────────────────────────────────────────

describe("Section F is a repeater, and the row has to be committed", () => {
  it("is declared with FLAG's own button and table wording", () => {
    expect(REPEATER.addButtonText).toBe("Add Place of Employment");
    expect(REPEATER.entriesLabel).toBe("Entries for Place of Employment");
  });

  it("reads the row count off FLAG's own heading", () => {
    const table = mountWorksiteRepeater({ rows: 2 });
    expect(repeaterRowCount(REPEATER)).toBe(2);
    expect(table.rows).toBe(2);
  });

  it("says so, rather than guessing, when the table is not on the page", () => {
    expect(repeaterRowCount(REPEATER)).toBe(-1);
  });

  it("commits the row and reports the table growing", async () => {
    const table = mountWorksiteRepeater();
    const out = await commitRepeaterRow(REPEATER);
    expect(out).toEqual({ status: "added", rows: 1 });
    expect(table.clicks).toBe(1);
    expect(repeaterRowCount(REPEATER)).toBe(1);
  });

  it("reports a greyed-out Add button with the errors FLAG is showing", async () => {
    // Exactly what the live page listed on 2026-10-27, with the Add button grey.
    const errors = [
      "Wage Rate Paid to Nonimmigrant Workers To: The 'To' must be higher than the 'From' wage rate",
      "Wage Level: This field is required",
      "Prevailing Wage Rate: This field is required",
    ];
    const table = mountWorksiteRepeater({ errors });
    const out = await commitRepeaterRow(REPEATER);
    expect(out.status).toBe("disabled");
    expect(out.status === "disabled" && out.errors).toEqual(errors);
    // Never forced. A click on a disabled button does nothing on the live page,
    // so pressing it anyway would only let the walk claim a row it never made.
    expect(table.clicks).toBe(0);
  });

  it("reports a press that did not take, instead of assuming it did", async () => {
    const table = mountWorksiteRepeater({ commits: false });
    const out = await commitRepeaterRow(REPEATER);
    expect(out.status).toBe("refused");
    expect(out.status === "refused" && out.rows).toBe(0);
    expect(table.clicks).toBe(1);
  }, 10000);

  it("reports a missing button", async () => {
    expect(await commitRepeaterRow(REPEATER)).toEqual({ status: "no-button" });
  });

  it("presses Add after the fields, on a section that declares a repeater", async () => {
    document.body.innerHTML = radios("_section_f_f2_is_secondary_entity", ["YES", "NO"]);
    const table = mountWorksiteRepeater();
    const out = await runSection(
      SECTION_F,
      { _section_f_f2_is_secondary_entity: "NO" },
      ETA9035_FORBIDDEN,
    );
    expect(out.fields.find((f) => f.name === "_section_f_f2_is_secondary_entity")?.status).toBe("filled");
    expect(out.row).toEqual({ status: "added", rows: 1 });
    expect(table.clicks).toBe(1);
  }, 15000);

  it("leaves a section that is not a repeater alone", async () => {
    const section = ETA9035_SECTIONS.find((s) => s.title.startsWith("K —"))!;
    document.body.innerHTML = `<input name="k1_prep_last" />`;
    mountWorksiteRepeater();
    const out = await runSection(section, { k1_prep_last: "Rajak" }, ETA9035_FORBIDDEN);
    expect(out.row).toBeUndefined();
    expect(repeaterRowCount(REPEATER)).toBe(0);
  }, 15000);
});

// ── the calculator ─────────────────────────────────────────────────────────

/** Section F as FLAG serves it once the source radio says OES. */
function mountOesSectionF(
  calculator: Parameters<typeof mountOesCalculator>[0] = {},
): ReturnType<typeof mountOesCalculator> {
  document.body.innerHTML =
    radios(PW_SOURCE, [PWD, OES, "f14_non_oes_prevailing_wage"]) +
    radios("_section_f_f13a_wage_level", ["I", "II", "III", "IV", "N/A"]) +
    radios("_section_f_f10a_nonimmigrant_wage_per", ["Hour", "Week", "Month", "Year"]) +
    radios("_section_f_f11a_prevailing_wage_per", ["Hour", "Week", "Month", "Year"]);
  // F.11 and F.13a are DISABLED on the live page once the source is OES — the
  // calculator owns them. Reproduced, because the whole point is not to fight it.
  for (const el of document.querySelectorAll<HTMLInputElement>(
    '[name="_section_f_f13a_wage_level"], [name="_section_f_f11a_prevailing_wage_per"]',
  )) {
    el.disabled = true;
  }
  const box = mountCurrencyBox("_section_f_f11_prevailing_wage", { disabled: true });
  box.input.disabled = true;
  return mountOesCalculator(calculator);
}

/** What the feed sends for an OES filing, verbatim in shape. */
const OES_VALUES = {
  [PW_SOURCE]: OES,
  _section_f_f8_work_state_id: "CALIFORNIA",
  _section_f_f7_work_county_id: "Santa Clara",
  _section_f_f13a_wage_level: "II",
  _section_f_f10a_nonimmigrant_wage_per: "Year",
  _section_f_f11a_prevailing_wage_per: "Year",
  _section_f_f11_prevailing_wage: "123531",
};

describe("the OES Wage Calculator is driven, not left manual", () => {
  it("is no longer on the refused list, and the reversal is dated in the code", () => {
    expect(isForbidden({ name: "OES Wage Calculator", kind: "search" }, ETA9035_FORBIDDEN)).toBeNull();
    const note = ETA9035_NOT_AUTOFILLED.find((f) => f.box === "F.13")!;
    expect(note.reason).toMatch(/driven/i);
  });

  it("is attached to Section F and gated on the OES branch", () => {
    expect(SECTION_F.modal).toBe(OES_WAGE_CALCULATOR);
    expect(OES_WAGE_CALCULATOR.onlyWhen).toEqual({ by: PW_SOURCE, is: [OES] });
  });

  it("owns exactly the boxes FLAG disables on the OES branch", () => {
    // The old extension's OES_POPULATED_FIELDS, by their FLAG names.
    expect([...OES_WAGE_CALCULATOR.owns].sort()).toEqual(
      [
        "_section_f_f11_prevailing_wage",
        "_section_f_f11a_prevailing_wage_per",
        "_section_f_f13a_wage_level",
        "_section_f_f13b_source_year",
        "_section_f_f7_work_county_id",
      ].sort(),
    );
  });

  it("does nothing at all on a filing whose wage source is not OES", async () => {
    const calc = mountOesSectionF();
    const out = await runModal(OES_WAGE_CALCULATOR, { [PW_SOURCE]: PWD });
    expect(out.status).toBe("skipped");
    expect(calc.opens).toBe(0);
  });

  it("opens it, fills it, calculates, and applies the answer", async () => {
    const calc = mountOesSectionF();
    const out = await runModal(OES_WAGE_CALCULATOR, OES_VALUES);
    expect(out.status).toBe("applied");
    expect(out.result).toBe("$61.52");
    expect(calc.opens).toBe(1);
    expect(calc.calculates).toBe(1);
    expect(calc.submits).toBe(1);
    expect(calc.applied).toMatchObject({
      prevailing_wage: "$61.52",
      wage_level: "II",
      area: "Santa Clara County, CA",
    });
    // The wage level landed even though FLAG keeps it disabled until Calculate.
    expect(OES_WAGE_CALCULATOR.fields.filter((f) => f.afterCalculate).map((f) => f.name)).toEqual([
      "OES_wage_level",
      "OES_per",
    ]);
    // And every field it filled was answered, not quietly missed.
    expect(out.fields.filter((f) => f.status !== "filled")).toEqual([]);
  }, 30000);

  it("makes the three standing choices itself, and the toolbar names them", () => {
    const ours = OES_WAGE_CALCULATOR.fields.filter((f) => f.constant);
    expect(ours.map((f) => [f.name, f.constant])).toEqual([
      ["OES_collection_type", "All Industries"],
      ["OES_area_based", "County/Township"],
      ["OES_rd_flag", "No"],
    ]);
    expect(ETA9035_NOT_AUTOFILLED.find((f) => f.box === "F.13")!.reason).toContain(
      "All Industries / County-Township / R&D No",
    );
  });

  it("never reaches the application's own Review & Submit", () => {
    // The modal's own apply button is labelled Submit, so the button search
    // cannot blanket-refuse that word. "Review" is what keeps the application's
    // Submit out of reach — and the modal search is scoped to the dialog too.
    document.body.innerHTML = "<button>Review &amp; Submit</button><button>Submit</button>";
    expect(findButtonByText("Review & Submit")).toBeNull();
    expect(findButtonByText("Submit")?.textContent).toBe("Submit");
  });

  it("drives the calculator's per-unit from the OFFERED wage unit, not the prevailing one", async () => {
    // SOF-643, settled on the old portal: an OES "Per" of Year against an
    // hourly offer returns an ANNUAL prevailing wage and locks F.10a/F.11a to
    // Year, so "$43/hr" is then read as "$43/yr" and the filing is refused.
    const per = OES_WAGE_CALCULATOR.fields.find((f) => f.name === "OES_per")!;
    expect(per.from).toBe("_section_f_f10a_nonimmigrant_wage_per");
    const calc = mountOesSectionF();
    await runModal(OES_WAGE_CALCULATOR, {
      ...OES_VALUES,
      _section_f_f10a_nonimmigrant_wage_per: "Hour",
      _section_f_f11a_prevailing_wage_per: "Year",
    });
    expect(calc.applied?.per).toBe("Hour");
  }, 30000);

  it("does NOT submit a calculator that produced no wage, and says so", async () => {
    const calc = mountOesSectionF({ noResult: true });
    const out = await runModal(OES_WAGE_CALCULATOR, OES_VALUES);
    expect(out.status).toBe("no-result");
    expect(calc.submits).toBe(0);
    expect(out.message).toContain("finish it yourself");
    // Left open, with the caseworker in front of it.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  }, 30000);

  it("reports a button that opens nothing, rather than typing on regardless", async () => {
    const calc = mountOesSectionF({ neverOpens: true });
    const out = await runModal(OES_WAGE_CALCULATOR, OES_VALUES);
    expect(out.status).toBe("did-not-open");
    expect(calc.calculates).toBe(0);
  }, 30000);

  it("reports a field a redesign moved, instead of failing the whole modal", async () => {
    const calc = mountOesSectionF({ omit: ["OES_state"] });
    const out = await runModal(OES_WAGE_CALCULATOR, OES_VALUES);
    expect(out.fields.find((f) => f.name === "OES_state")?.status).toBe("not-rendered");
    // and the rest still ran.
    expect(out.status).toBe("applied");
    expect(calc.submits).toBe(1);
  }, 30000);

});

describe("Section F, driven whole", () => {
  it("runs the calculator, leaves the boxes it owns alone, and commits the row", async () => {
    const calc = mountOesSectionF();
    const table = mountWorksiteRepeater();
    const out = await runSection(SECTION_F, OES_VALUES, ETA9035_FORBIDDEN);

    expect(out.modal?.status).toBe("applied");
    expect(calc.submits).toBe(1);
    // The source radio is answered FIRST: neither the calculator's button nor
    // the boxes it owns exist until it says OES.
    expect(out.fields[0].name).toBe(PW_SOURCE);
    expect(out.fields[0].status).toBe("filled");
    // The boxes the calculator owns are reported as left alone, with the reason
    // — not typed over with the case's own annual PWD, which is what turned a
    // correct $49.44/hr into $123531 and failed F.10 on the old portal.
    for (const name of OES_WAGE_CALCULATOR.owns) {
      const field = out.fields.find((f) => f.name === name);
      if (!field) continue;
      expect(field.status, name).toBe("skipped");
      expect(field.message, name).toContain("OES Wage Calculator");
    }
    expect(out.row).toEqual({ status: "added", rows: 1 });
    expect(table.clicks).toBe(1);
  }, 30000);

  it("still types the prevailing wage on a filing that is NOT on the OES branch", async () => {
    // F.11 is only the calculator's on the OES branch. On a PWD filing it is an
    // ordinary box and has to be typed, or the section cannot be saved.
    document.body.innerHTML = radios(PW_SOURCE, [PWD, OES]);
    const box = mountCurrencyBox("_section_f_f11_prevailing_wage");
    mountWorksiteRepeater();
    const out = await runSection(
      SECTION_F,
      { [PW_SOURCE]: PWD, _section_f_f11_prevailing_wage: "123531" },
      ETA9035_FORBIDDEN,
    );
    expect(out.modal).toBeUndefined();
    expect(out.fields.find((f) => f.name === "_section_f_f11_prevailing_wage")?.status).toBe("filled");
    expect(box.input.value).toBe("$123,531.00");
  }, 30000);
});

// ── the disabled guard ─────────────────────────────────────────────────────

describe("a control FLAG has disabled is never reported as filled", () => {
  const section = (name: string): FlagSection => ({
    navLabel: "x",
    title: "x",
    fields: [{ name, kind: "radio" }],
  });

  it("does not claim a wage level the page has greyed out", async () => {
    // The live symptom: "Wage Level: This field is required" on screen while
    // the run reported it filled. A click on a disabled radio is dropped, but
    // `click()` still returns, so nothing used to notice.
    document.body.innerHTML = radios("_section_f_f13a_wage_level", ["I", "II", "III"]);
    for (const el of document.querySelectorAll<HTMLInputElement>("input")) el.disabled = true;
    const out = await fillSection(
      section("_section_f_f13a_wage_level"),
      { _section_f_f13a_wage_level: "II" },
      [],
    );
    expect(out[0].status).toBe("failed");
    expect(document.querySelector<HTMLInputElement>('input[value="II"]')!.checked).toBe(false);
  });

  it("does not claim a disabled select either", async () => {
    document.body.innerHTML =
      '<select name="_section_f_f13b_source_year" disabled>' +
      '<option value="">- Select -</option><option>7/1/2026 - 6/30/2027</option></select>';
    const out = await fillSection(
      { navLabel: "x", title: "x", fields: [{ name: "_section_f_f13b_source_year", kind: "select" }] },
      { _section_f_f13b_source_year: "7/1/2026 - 6/30/2027" },
      [],
    );
    expect(out[0].status).toBe("failed");
    expect(out[0].message).toContain("disabled");
  });

  it("still fills the same control once FLAG enables it", async () => {
    document.body.innerHTML = radios("_section_f_f13a_wage_level", ["I", "II", "III"]);
    const out = await fillSection(
      section("_section_f_f13a_wage_level"),
      { _section_f_f13a_wage_level: "II" },
      [],
    );
    expect(out[0].status).toBe("filled");
  });
});
