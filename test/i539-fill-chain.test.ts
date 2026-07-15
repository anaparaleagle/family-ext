// The fill PLAN for the I-539, exercised against the real I539_PAGES descriptor
// with a mock payload. Pure planning only — no DOM, no backend.
//
// A mock payload is the honest tool here: the I-539 backend map does not exist
// yet, so there is no real {field: value} to fill with. These lock the
// descriptor-driven behaviour (ordering, repeater expansion, conditional
// tolerance) so that when the backend map lands, only the VALUES are new.

import { describe, it, expect } from "vitest";
import { planPageFill, repeaterRowCount } from "../src/runner/fill-chain";
import { pageForUrl } from "../src/runner/section-detector";
import { I539_PAGES } from "../src/i539/form-descriptor";

const BASE = "https://my.uscis.gov/forms/application-to-extend-change-nonimmigrant-status/13212561";

function page(slug: string) {
  const p = I539_PAGES.find((x) => x.slug === slug);
  if (!p) throw new Error(`no page ${slug}`);
  return p;
}

describe("I-539 section detection", () => {
  it("detects a page by URL slug, ignoring the app_to_rep_id query", () => {
    const p = pageForUrl(I539_PAGES, `${BASE}/about-you/your-name?app_to_rep_id=d8249b5b`);
    expect(p?.slug).toBe("/about-you/your-name");
  });

  it("prefers the longer nested slug over its prefix", () => {
    // /about-you/your-immigration-information is a real page AND the prefix of
    // its page-2 — the longer one must win or page 2 fills with page 1's fields.
    const p = pageForUrl(
      I539_PAGES,
      `${BASE}/about-you/your-immigration-information/your-immigration-information-page-2`,
    );
    expect(p?.slug).toBe("/about-you/your-immigration-information/your-immigration-information-page-2");
  });

  it("does not confuse the two moral-character affiliation pages", () => {
    const p = pageForUrl(
      I539_PAGES,
      `${BASE}/moral-character/party-and-group-affiliations/party-and-group-affiliations-page-2`,
    );
    expect(p?.slug).toBe(
      "/moral-character/party-and-group-affiliations/party-and-group-affiliations-page-2",
    );
  });

  it("returns null for a myUSCIS account page", () => {
    expect(pageForUrl(I539_PAGES, "https://my.uscis.gov/account/dashboard")).toBeNull();
  });
});

describe("I-539 planPageFill (pure)", () => {
  it("puts radios first, then country, then state, then the rest", () => {
    const plan = planPageFill(page("/about-you/your-contact-information"), {
      "applicant.yourContactInformation.mailingAddress.city": "Austin",
      "applicant.yourContactInformation.mailingAddress.state": "Texas",
      "applicant.yourContactInformation.foreignPhysicalAddress.country": "India",
      "applicant.yourContactInformation.isMailingEqualToPhysical": "true",
    });
    const names = plan.map((p) => p.spec.name);
    const radioIdx = names.indexOf("applicant.yourContactInformation.isMailingEqualToPhysical");
    const countryIdx = names.indexOf("applicant.yourContactInformation.foreignPhysicalAddress.country");
    const stateIdx = names.indexOf("applicant.yourContactInformation.mailingAddress.state");
    const cityIdx = names.indexOf("applicant.yourContactInformation.mailingAddress.city");
    // Radios lead because answering one can reveal conditional fields below it.
    expect(radioIdx).toBeLessThan(countryIdx);
    expect(countryIdx).toBeLessThan(stateIdx);
    expect(stateIdx).toBeLessThan(cityIdx);
  });

  it("skips conditional fields the payload has no value for", () => {
    // Happy path: passport is NOT different, so the revealed block stays empty.
    const plan = planPageFill(
      page("/about-you/your-immigration-information/your-immigration-information-page-2"),
      {
        "applicant.yourImmigrationInformation.yourImmigrationInformation2.isCurrentPassportDifferent":
          "false",
      },
    );
    expect(plan.map((p) => p.spec.name)).toEqual([
      "applicant.yourImmigrationInformation.yourImmigrationInformation2.isCurrentPassportDifferent",
    ]);
  });

  it("includes conditional fields once the payload supplies them", () => {
    const plan = planPageFill(
      page("/about-you/your-immigration-information/your-immigration-information-page-2"),
      {
        "applicant.yourImmigrationInformation.yourImmigrationInformation2.isCurrentPassportDifferent":
          "true",
        "applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.number.number":
          "X1234567",
        "applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.countryOfIssuance":
          "India",
      },
    );
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(
      "applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.number.number",
    );
    // The radio still leads, and country still precedes the plain text.
    expect(names[0]).toBe(
      "applicant.yourImmigrationInformation.yourImmigrationInformation2.isCurrentPassportDifferent",
    );
    expect(names.indexOf(
      "applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.countryOfIssuance",
    )).toBeLessThan(
      names.indexOf(
        "applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.number.number",
      ),
    );
  });

  it("passes a radio's coded option value through as the option to click", () => {
    // applicationType uses word codes, not true/false — the plan must carry the
    // exact emitted code so the value-setter clicks input[name][value].
    const plan = planPageFill(page("/getting-started/reason-for-request"), {
      "gettingStarted.reasonForRequest.applicationType": "changeOfStatus",
    });
    expect(plan[0].spec.optionValue).toBe("changeOfStatus");
    expect(plan[0].spec.kind).toBe("radio");
  });

  it("omits absent names and empty strings", () => {
    const plan = planPageFill(page("/about-you/your-name"), {
      "applicant.yourName.name.firstName": "Maya",
      "applicant.yourName.name.middleName": "",
      // lastName absent entirely
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toEqual(["applicant.yourName.name.firstName"]);
  });

  it("plans nothing for a page whose fields are all skipped", () => {
    // Preparer/interpreter pages carry no descriptor fields — a legitimate 0/0.
    expect(planPageFill(page("/getting-started/preparer"), { anything: "x" })).toEqual([]);
    expect(
      planPageFill(page("/getting-started/preparer-and-interpreter-information"), {}),
    ).toEqual([]);
  });

  it("plans the moral-character page as five true/false radios", () => {
    const plan = planPageFill(page("/moral-character/party-and-group-affiliations"), {
      "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInTortureOrGenocide.question":
        "false",
      "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInKillingAnyPerson.question":
        "false",
      "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInInjuringAnyPerson.question":
        "false",
      "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInForcedSexualContact.question":
        "false",
      "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInDenyingReligiousBeliefs.question":
        "false",
    });
    expect(plan.length).toBe(5);
    expect(plan.every((p) => p.spec.kind === "radio")).toBe(true);
  });
});

describe("I-539 additional-information repeater", () => {
  const additional = page("/additional-information/additional-information");

  it("counts the rows the payload supplies", () => {
    const count = repeaterRowCount(additional.repeater!, additional.fields, {
      "additionalInformationArray.0.section": "About You",
      "additionalInformationArray.0.response": "Explanation one.",
      "additionalInformationArray.1.section": "Your Application",
      "additionalInformationArray.1.response": "Explanation two.",
    });
    expect(count).toBe(2);
  });

  it("returns 0 rows when the payload has none", () => {
    expect(repeaterRowCount(additional.repeater!, additional.fields, {})).toBe(0);
  });

  it("expands {i} into one entry set per row, row 0 fully before row 1", () => {
    const plan = planPageFill(additional, {
      "additionalInformationArray.0.section": "About You",
      "additionalInformationArray.0.response": "First.",
      "additionalInformationArray.1.section": "Your Application",
      "additionalInformationArray.1.response": "Second.",
    });
    expect(plan.map((p) => p.spec.name)).toEqual([
      "additionalInformationArray.0.section",
      "additionalInformationArray.0.response",
      "additionalInformationArray.1.section",
      "additionalInformationArray.1.response",
    ]);
    expect(plan.map((p) => p.rowIndex)).toEqual([0, 0, 1, 1]);
  });

  it("stops counting at the first row with no data (no runaway rows)", () => {
    const count = repeaterRowCount(additional.repeater!, additional.fields, {
      "additionalInformationArray.0.response": "Only one.",
      // row 1 missing; row 2 present but unreachable — must not be counted.
      "additionalInformationArray.2.response": "Orphan.",
    });
    expect(count).toBe(1);
  });
});
