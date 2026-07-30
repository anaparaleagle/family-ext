// The descriptor vocabulary grew three optional pieces for shapes the N-400 has
// and the I-130/I-539 never did: a per-row commit button, a NESTED repeater, and
// a repeater whose row shape depends on a discriminator answer.
//
// These tests pin the behaviour that is actually load-bearing — index resolution
// and the fact that the additions are optional, so the two existing descriptors
// keep type-checking untouched.

import { describe, expect, it } from "vitest";
import { fieldNamesOf, t } from "../src/runner/types";
import type { FormPage, RepeaterSpec } from "../src/runner/types";
import { I130_PAGES } from "../src/i130/form-descriptor";
import { I539_PAGES } from "../src/i539/form-descriptor";

describe("fieldNamesOf index resolution", () => {
  it("resolves the nested index {j} as well as the row index {i}", () => {
    // Without this a nested field reads as an unmapped name in every coverage
    // comparison, which would make the travel page look permanently broken.
    const pages: FormPage[] = [
      {
        slug: "/about-you/travel-outside-the-us",
        title: "Travel outside the U.S.",
        kind: "form",
        fields: [
          t("applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.dateLeftTheUS"),
          t("applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.countries.{j}"),
        ],
      },
    ];
    expect(fieldNamesOf(pages)).toEqual([
      "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.0.dateLeftTheUS",
      "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.0.countries.0",
    ]);
  });

  it("leaves a name with no placeholder untouched", () => {
    const pages: FormPage[] = [
      { slug: "/x", title: "x", kind: "form", fields: [t("applicant.yourName.name.lastName")] },
    ];
    expect(fieldNamesOf(pages)).toEqual(["applicant.yourName.name.lastName"]);
  });
});

describe("RepeaterSpec additions are optional", () => {
  it("still accepts the original two-field shape", () => {
    // The I-130 and I-539 descriptors must keep compiling unchanged. If any of
    // the new members had been made required this would not type-check.
    const minimal: RepeaterSpec = {
      namePrefix: "applicant.yourAddressHistory",
      addButtonText: "add",
    };
    expect(minimal.rowCommitButtonText).toBeUndefined();
    expect(minimal.nested).toBeUndefined();
    expect(minimal.variants).toBeUndefined();
  });

  it("does not disturb the two existing descriptors' repeaters", () => {
    const existing = [...I130_PAGES, ...I539_PAGES].filter((p) => p.repeater);
    expect(existing.length).toBeGreaterThan(0);
    for (const page of existing) {
      expect(page.repeater!.namePrefix).toBeTruthy();
      expect(page.repeater!.addButtonText).toBeTruthy();
    }
  });
});

describe("RepeaterSpec expresses the N-400 shapes the old type could not", () => {
  it("carries a nested repeater with its own add control", () => {
    const travel: RepeaterSpec = {
      namePrefix: "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable",
      addButtonText: "add trip",
      rowCommitButtonText: "Save entry",
      nested: {
        namePrefix:
          "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.countries",
        addButtonText: "Add country",
      },
    };
    // The inner prefix must still carry the parent's {i} — an inner list belongs
    // to one specific row, not to the repeater as a whole.
    expect(travel.nested!.namePrefix).toContain("{i}");
    expect(travel.nested!.addButtonText).toBe("Add country");
  });

  it("carries four row variants keyed by the discriminator's exact option text", () => {
    const employment: RepeaterSpec = {
      namePrefix: "applicant.schoolsAndEmployment",
      addButtonText: "add entry",
      rowCommitButtonText: "Save entry",
      variants: {
        discriminator: "applicant.schoolsAndEmployment.{i}.schoolOrEmploymentType",
        shapes: {
          "Add an employer": ["employmentInfo.workName", "employmentInfo.occupation", "address.city"],
          "Add a period of self-employment": [
            "employmentInfo.workName",
            "employmentInfo.occupation",
            "address.city",
          ],
          "Add a period of unemployment": ["employmentInfo.workName"],
          "Add a school": ["schoolInfo.schoolName", "schoolInfo.fieldOfStudy", "address.city"],
        },
      },
    };
    expect(Object.keys(employment.variants!.shapes)).toHaveLength(4);
    // The whole point of variants: the shapes are NOT supersets of each other.
    expect(employment.variants!.shapes["Add a period of unemployment"]).not.toContain("address.city");
    expect(employment.variants!.shapes["Add a school"]).not.toContain("employmentInfo.workName");
    // The discriminator must be driven before the rest of the row exists.
    expect(employment.variants!.discriminator).toContain("{i}");
  });

  it("keeps the row-commit label an exact captured string, not a pattern", () => {
    // Four different labels across the N-400's repeaters. Storing a regex or a
    // lower-cased fragment here is what let "Save Entry" slip past on the I-539.
    const labels = ["Save entry", "Save child", "Save", "Save response"];
    for (const label of labels) {
      const spec: RepeaterSpec = { namePrefix: "x", addButtonText: "add", rowCommitButtonText: label };
      expect(spec.rowCommitButtonText).toBe(label);
    }
    // A bare "Save" is a substring of the other three, so a substring matcher
    // would resolve ambiguously. Recorded here so the chain uses exact matching.
    expect(labels.filter((l) => l.includes("Save"))).toHaveLength(4);
  });
});
