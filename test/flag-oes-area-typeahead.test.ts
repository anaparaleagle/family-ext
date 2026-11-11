// The ETA-9035E's OES Wage Calculator "Area" box, and the cascade behind it.
//
// LIVE, flag.dol.gov, 2026-10-27. The calculator opened and took five of its
// six answers — State TEXAS, the 2026-27 date series, All Industries,
// County/Township, R&D No — and AREA stayed empty with "This field is
// required". FLAG therefore kept Calculate grey, the calculator produced no
// prevailing wage, and the rest of Section F fell over behind it: F.11/F.13a
// empty, the worksite State and the offered-wage unit greyed out, and "Add
// Place of Employment" refused with "Field F: Please enter in at least one row".
//
// Area is a SEARCH box, not a select, and FLAG serves it the way the old H-1B
// extension's `fillSearchField` was written for: the option list is PORTALLED
// to <body>, outside the dialog, reachable only through `aria-controls`, and
// its items are `<li class="dropdown-item">` with no role="option". The option
// scan here was clamped to the open dialog and looked only for MUI-shaped
// options, so it saw an empty list every time.

import { describe, it, expect, beforeEach } from "vitest";
import { OES_WAGE_CALCULATOR } from "../src/flag/eta9035-descriptor";
import { runModal } from "../src/flag/modal";
import { setValue } from "../src/engine/value-setter";
import { mountOesCalculator } from "./fixtures/dom";

const PW_SOURCE = "_section_f_f12_f13_f14_prevailing_wage_question";
const OES = "f13_is_oes_prevailing_wage";

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

/** Section F as FLAG serves it on the OES branch, with the live Area widget. */
function mountLiveSectionF(
  opts: Parameters<typeof mountOesCalculator>[0] = {},
): ReturnType<typeof mountOesCalculator> {
  document.body.innerHTML =
    radios(PW_SOURCE, [OES]) +
    radios("_section_f_f13a_wage_level", ["I", "II", "III", "IV", "N/A"]) +
    radios("_section_f_f10a_nonimmigrant_wage_per", ["Hour", "Week", "Month", "Year"]);
  return mountOesCalculator({
    areaIsPortalled: true,
    areaOptions: ["Harris County, TX", "Harrison County, TX", "Hardin County, TX"],
    ...opts,
  });
}

/** The Houston worksite, as the feed sends it. F.7 carries the county with a
 * trailing " County" already stripped (the backend's own `county` derivation),
 * which is what the calculator searches on — exactly as the old portal did. */
const HOUSTON = {
  [PW_SOURCE]: OES,
  _section_f_f8_work_state_id: "TEXAS",
  _section_f_f7_work_county_id: "Harris",
  _section_f_f13a_wage_level: "II",
  _section_f_f10a_nonimmigrant_wage_per: "Year",
};

describe("the Area box takes an option list rendered outside the dialog", () => {
  it("reaches a portalled list through aria-controls and commits the county", async () => {
    mountLiveSectionF();
    document.querySelector<HTMLButtonElement>("button")!.click();
    await new Promise((r) => setTimeout(r, 2200));
    const area = document.querySelector<HTMLInputElement>("#OES_area")!;
    expect(area.getAttribute("placeholder")).toBe("Type search term here");

    const res = await setValue(
      { name: "OES_area", kind: "search", locate: { id: "OES_area" } },
      "Harris",
    );
    expect(res.success).toBe(true);
    // The county, not the one that merely starts with the same letters.
    expect(area.value).toBe("Harris County, TX");
  }, 30000);

  it("drives the whole calculator, so Calculate stops being grey", async () => {
    const calc = mountLiveSectionF();
    const out = await runModal(OES_WAGE_CALCULATOR, HOUSTON);
    expect(out.fields.find((f) => f.name === "OES_area")?.status).toBe("filled");
    expect(out.status).toBe("applied");
    expect(calc.calculates).toBe(1);
    expect(calc.submits).toBe(1);
    expect(calc.applied?.area).toBe("Harris County, TX");
    expect(out.stillOpen).toBe(false);
  }, 60000);
});

describe("when the Area still will not take", () => {
  it("says which input was missing instead of blaming DOL for the wage", async () => {
    // No option matches, so nothing commits, so FLAG keeps Calculate grey.
    // That is OUR miss to fix, not "DOL has no data for this combination",
    // and the two used to read identically in the toolbar.
    const calc = mountLiveSectionF({ areaOptions: ["Travis County, TX"] });
    const out = await runModal(OES_WAGE_CALCULATOR, HOUSTON);
    expect(out.status).toBe("cannot-calculate");
    expect(out.message).toContain("OES_area");
    expect(out.stillOpen).toBe(true);
    // Never pressed: FLAG would refuse it and leave the dialog over the page.
    expect(calc.submits).toBe(0);
    expect(calc.applied).toBeNull();
  }, 60000);

  it("reports a feed with no county at all as exactly that", async () => {
    mountLiveSectionF();
    const { _section_f_f7_work_county_id: _drop, ...noCounty } = HOUSTON;
    const out = await runModal(OES_WAGE_CALCULATOR, noCounty);
    const area = out.fields.find((f) => f.name === "OES_area")!;
    expect(area.status).toBe("no-value");
    expect(area.message).toContain("_section_f_f7_work_county_id");
  }, 60000);
});
