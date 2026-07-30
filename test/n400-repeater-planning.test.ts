// The two N-400 repeater shapes the planner did NOT handle. Both are pure-layer
// bugs, so they are tested here without any DOM.
//
// 1. NESTED lists. planPageFill only ever expanded `{i}`, so a nested field name
//    kept a literal `{j}` and therefore never matched a payload key. The travel
//    page's per-trip country list was silently dropped in full — no failure, no
//    log line, just absent.
//
// 2. POLYMORPHIC rows. The row shape is chosen by a discriminator, and the row
//    renders NOTHING until it is set. The planner had no notion of that, so the
//    discriminator sorted by generic rank (a `search` field, rank 3) and could be
//    driven AFTER the fields it makes exist. That is the same mistake the I-539
//    premium radio taught: attempting a field before the thing that reveals it.
//    It also planned every shape's fields at once, so an unemployment row would
//    attempt address inputs that legitimately do not exist on it.

import { describe, expect, it } from "vitest";
import { findSaveButton, planPageFill } from "../src/runner/fill-chain";
import { cond, check, radio, search, t } from "../src/runner/types";
import type { FormPage } from "../src/runner/types";

const TRAVEL_PREFIX = "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable";

const travelPage = (): FormPage => ({
  slug: "/about-you/travel-outside-the-us",
  title: "Travel outside the U.S.",
  kind: "form",
  fields: [
    radio("formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years", ["true", "false"]),
    t(`${TRAVEL_PREFIX}.{i}.dateLeftTheUS`),
    t(`${TRAVEL_PREFIX}.{i}.dateReturnedToUS`),
    search(`${TRAVEL_PREFIX}.{i}.countries.{j}`),
  ],
  repeater: {
    namePrefix: TRAVEL_PREFIX,
    addButtonText: "add trip",
    rowCommitButtonText: "Save entry",
    nested: { namePrefix: `${TRAVEL_PREFIX}.{i}.countries`, addButtonText: "Add country" },
  },
});

const EMP_PREFIX = "applicant.schoolsAndEmployment";

const employmentPage = (): FormPage => ({
  slug: "/about-you/schools-and-employment",
  title: "Schools and employment",
  kind: "form",
  fields: [
    search(`${EMP_PREFIX}.{i}.schoolOrEmploymentType`),
    cond(t(`${EMP_PREFIX}.{i}.employmentInfo.workName`)),
    cond(search(`${EMP_PREFIX}.{i}.employmentInfo.occupation`)),
    cond(t(`${EMP_PREFIX}.{i}.schoolInfo.schoolName`)),
    cond(t(`${EMP_PREFIX}.{i}.schoolInfo.fieldOfStudy`)),
    t(`${EMP_PREFIX}.{i}.dates.fromDate`),
    check(`${EMP_PREFIX}.{i}.dates.toPresent`),
    cond(t(`${EMP_PREFIX}.{i}.address.city`)),
  ],
  repeater: {
    namePrefix: EMP_PREFIX,
    addButtonText: "add entry",
    rowCommitButtonText: "Save entry",
    variants: {
      discriminator: `${EMP_PREFIX}.{i}.schoolOrEmploymentType`,
      shapes: {
        "Add an employer": [
          "employmentInfo.workName", "employmentInfo.occupation",
          "dates.fromDate", "dates.toPresent", "address.city",
        ],
        "Add a period of unemployment": ["employmentInfo.workName", "dates.fromDate", "dates.toPresent"],
        "Add a school": [
          "schoolInfo.schoolName", "schoolInfo.fieldOfStudy",
          "dates.fromDate", "dates.toPresent", "address.city",
        ],
      },
    },
  },
});

describe("planPageFill — NESTED repeater ({j})", () => {
  it("expands the inner index for every nested value the payload supplies", () => {
    const plan = planPageFill(travelPage(), {
      "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years": "true",
      [`${TRAVEL_PREFIX}.0.dateLeftTheUS`]: "01/02/2022",
      [`${TRAVEL_PREFIX}.0.dateReturnedToUS`]: "02/02/2022",
      [`${TRAVEL_PREFIX}.0.countries.0`]: "India",
      [`${TRAVEL_PREFIX}.0.countries.1`]: "United Kingdom",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${TRAVEL_PREFIX}.0.countries.0`);
    expect(names).toContain(`${TRAVEL_PREFIX}.0.countries.1`);
    // A literal placeholder must never survive into a plan — it can only ever
    // fail to match an input, which is exactly how this went unnoticed.
    expect(names.filter((n) => n.includes("{j}"))).toEqual([]);
    expect(names.filter((n) => n.includes("{i}"))).toEqual([]);
  });

  it("expands nested values independently per outer row", () => {
    const plan = planPageFill(travelPage(), {
      "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years": "true",
      [`${TRAVEL_PREFIX}.0.dateLeftTheUS`]: "01/02/2022",
      [`${TRAVEL_PREFIX}.0.countries.0`]: "India",
      [`${TRAVEL_PREFIX}.1.dateLeftTheUS`]: "03/04/2023",
      [`${TRAVEL_PREFIX}.1.countries.0`]: "Canada",
      [`${TRAVEL_PREFIX}.1.countries.1`]: "Mexico",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${TRAVEL_PREFIX}.0.countries.0`);
    expect(names).toContain(`${TRAVEL_PREFIX}.1.countries.0`);
    expect(names).toContain(`${TRAVEL_PREFIX}.1.countries.1`);
    // Row 0 must be fully planned before row 1 — rows are committed one at a time.
    const firstRow1 = names.findIndex((n) => n.includes(`${TRAVEL_PREFIX}.1.`));
    const lastRow0 = names.reduce((acc, n, i) => (n.includes(`${TRAVEL_PREFIX}.0.`) ? i : acc), -1);
    expect(lastRow0).toBeLessThan(firstRow1);
  });

  it("plans no nested field when the payload supplies none", () => {
    const plan = planPageFill(travelPage(), {
      "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years": "true",
      [`${TRAVEL_PREFIX}.0.dateLeftTheUS`]: "01/02/2022",
    });
    expect(plan.map((p) => p.spec.name).filter((n) => n.includes("countries"))).toEqual([]);
  });
});

describe("planPageFill — POLYMORPHIC rows (variants)", () => {
  it("drives the discriminator before any other field in the row", () => {
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.schoolOrEmploymentType`]: "Add an employer",
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "Test Corp",
      [`${EMP_PREFIX}.0.employmentInfo.occupation`]: "I.T. Software Development",
      [`${EMP_PREFIX}.0.dates.fromDate`]: "01/01/2020",
      [`${EMP_PREFIX}.0.address.city`]: "New York",
    });
    const names = plan.map((p) => p.spec.name);
    // Nothing in the row exists until the type is chosen, so it must be first.
    expect(names[0]).toBe(`${EMP_PREFIX}.0.schoolOrEmploymentType`);
  });

  it("plans ONLY the selected shape's fields", () => {
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.schoolOrEmploymentType`]: "Add a period of unemployment",
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "Unemployed",
      [`${EMP_PREFIX}.0.dates.fromDate`]: "01/01/2020",
      // The backend may still send these; an unemployment row has no such inputs.
      [`${EMP_PREFIX}.0.address.city`]: "New York",
      [`${EMP_PREFIX}.0.employmentInfo.occupation`]: "I.T. Software Development",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${EMP_PREFIX}.0.employmentInfo.workName`);
    expect(names).toContain(`${EMP_PREFIX}.0.dates.fromDate`);
    // Not in the unemployment shape — attempting these produces phantom failures.
    expect(names).not.toContain(`${EMP_PREFIX}.0.address.city`);
    expect(names).not.toContain(`${EMP_PREFIX}.0.employmentInfo.occupation`);
  });

  it("plans the school shape's fields for a school row", () => {
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.schoolOrEmploymentType`]: "Add a school",
      [`${EMP_PREFIX}.0.schoolInfo.schoolName`]: "Test University",
      [`${EMP_PREFIX}.0.schoolInfo.fieldOfStudy`]: "Engineering",
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "should not be attempted",
      [`${EMP_PREFIX}.0.address.city`]: "Boston",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${EMP_PREFIX}.0.schoolInfo.schoolName`);
    expect(names).toContain(`${EMP_PREFIX}.0.schoolInfo.fieldOfStudy`);
    expect(names).toContain(`${EMP_PREFIX}.0.address.city`);
    expect(names).not.toContain(`${EMP_PREFIX}.0.employmentInfo.workName`);
  });

  it("allows different shapes on different rows", () => {
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.schoolOrEmploymentType`]: "Add an employer",
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "Test Corp",
      [`${EMP_PREFIX}.1.schoolOrEmploymentType`]: "Add a school",
      [`${EMP_PREFIX}.1.schoolInfo.schoolName`]: "Test University",
      [`${EMP_PREFIX}.1.employmentInfo.workName`]: "should not be attempted",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${EMP_PREFIX}.0.employmentInfo.workName`);
    expect(names).toContain(`${EMP_PREFIX}.1.schoolInfo.schoolName`);
    expect(names).not.toContain(`${EMP_PREFIX}.1.employmentInfo.workName`);
  });

  it("falls back to planning everything when the discriminator has no value", () => {
    // If the backend sent no type we cannot know the shape. Dropping the whole row
    // would lose data silently; planning it all lets the DOM decide, and the
    // fields are cond(...) so absent ones skip quietly rather than failing.
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "Test Corp",
      [`${EMP_PREFIX}.0.schoolInfo.schoolName`]: "Test University",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(`${EMP_PREFIX}.0.employmentInfo.workName`);
    expect(names).toContain(`${EMP_PREFIX}.0.schoolInfo.schoolName`);
  });

  it("ignores an unrecognised discriminator value rather than dropping the row", () => {
    // USCIS could rename an option. Losing the row silently would be the worst
    // outcome, so an unknown shape behaves like the no-value case.
    const plan = planPageFill(employmentPage(), {
      [`${EMP_PREFIX}.0.schoolOrEmploymentType`]: "Add a something we have never seen",
      [`${EMP_PREFIX}.0.employmentInfo.workName`]: "Test Corp",
    });
    expect(plan.map((p) => p.spec.name)).toContain(`${EMP_PREFIX}.0.employmentInfo.workName`);
  });
});

// ── The row-commit button ───────────────────────────────────────────────────
// A bare "Save" is a substring of "Save entry", "Save child" and "Save response",
// so on a page rendering more than one save-ish control the generic passes can
// resolve to the wrong button. The descriptor carries the captured label; these
// tests pin that it is preferred, and that the generic fallback still works when
// USCIS has renamed it.

describe("findSaveButton — preferred label", () => {
  it("prefers the descriptor's exact label over a generic save match", () => {
    document.body.innerHTML = `
      <button>Save</button>
      <button>Save child</button>
    `;
    const btn = findSaveButton(document, "Save child");
    expect(btn?.textContent?.trim()).toBe("Save child");
  });

  it("matches exactly, so 'Save' does not pick up 'Save response'", () => {
    document.body.innerHTML = `
      <button>Save response</button>
      <button>Save</button>
    `;
    expect(findSaveButton(document, "Save")?.textContent?.trim()).toBe("Save");
  });

  it("falls back to the generic match when the declared label is absent", () => {
    // USCIS renamed the control. Falling back beats refusing to commit the row.
    document.body.innerHTML = `<button>Save entry</button>`;
    expect(findSaveButton(document, "Save child")?.textContent?.trim()).toBe("Save entry");
  });

  it("still never clicks a leave-the-form control", () => {
    document.body.innerHTML = `<button>Save and exit</button>`;
    expect(findSaveButton(document, "Save and exit")).toBeNull();
  });
});
