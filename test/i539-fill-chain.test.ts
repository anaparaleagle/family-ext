// The fill PLAN for the I-539, exercised against the real I539_PAGES descriptor
// with a mock payload. Pure planning only — no DOM, no backend.
//
// A mock payload is the honest tool here: the I-539 backend map does not exist
// yet, so there is no real {field: value} to fill with. These lock the
// descriptor-driven behaviour (ordering, repeater expansion, conditional
// tolerance) so that when the backend map lands, only the VALUES are new.

import { describe, it, expect } from "vitest";
import {
  planPageFill,
  repeaterRowCount,
  isForbiddenAdvanceControl,
  onTerminalPath,
} from "../src/runner/fill-chain";
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

describe("I-539 review page — never walk into Submit/Pay", () => {
  it("detects the captured review page and marks it terminal", () => {
    const p = pageForUrl(
      I539_PAGES,
      `${BASE}/review-and-submit/review-your-application?app_to_rep_id=d8249b5b`,
    );
    expect(p?.slug).toBe("/review-and-submit/review-your-application");
    expect(p?.kind).toBe("review");
  });

  it("the review page's real Next button is NOT caught by the text guard", () => {
    // Documents the live 2026-07-15 finding rather than pretending otherwise:
    // the control that advances past review is a plain "Next" (id=button-button,
    // data-testid=next-button). No Submit/Pay text to match, so the text guard
    // is blind to it — which is exactly why the descriptor entry (kind:"review")
    // and onTerminalPath() exist. If this ever starts returning true, the guard
    // has become over-broad and will break the walk on every ordinary page.
    const next = document.createElement("button");
    next.id = "button-button";
    next.setAttribute("data-testid", "next-button");
    next.textContent = "Next";
    expect(isForbiddenAdvanceControl(next)).toBe(false);
  });

  it("still refuses the downstream Submit/Pay/e-sign controls by text", () => {
    for (const label of [
      "Submit",
      "Pay and submit",
      "Continue to payment",
      "E-sign",
      "Sign and submit",
      "File and pay",
      "Checkout",
    ]) {
      const b = document.createElement("button");
      b.textContent = label;
      expect(isForbiddenAdvanceControl(b), `should refuse "${label}"`).toBe(true);
    }
  });

  it("treats the whole review-and-submit section as terminal, by path", () => {
    // The parent path is the stable signal: every terminal route myUSCIS has
    // lives under it (routes read from the live JS bundle 2026-07-15).
    for (const slug of [
      "/review-and-submit/review-your-application",
      "/review-and-submit/your-statement",
      "/review-and-submit/your-signature",
      "/review-and-submit/representative-signature",
      "/review-and-submit/pay-and-submit",
      "/review-and-submit/submit-confirmation",
    ]) {
      expect(onTerminalPath(`${BASE}${slug}?app_to_rep_id=d8249b5b`), slug).toBe(true);
    }
  });

  it("stops even if USCIS RENAMES the review slug (drift case)", () => {
    // The descriptor would no longer recognize this page, so the walk's
    // unknown-page branch would click Next straight toward Submit. The path
    // guard is what saves us.
    const renamed = `${BASE}/review-and-submit/review-your-form-539`;
    expect(pageForUrl(I539_PAGES, renamed)).toBeNull();
    expect(onTerminalPath(renamed)).toBe(true);
  });

  it("does not treat ordinary form pages as terminal", () => {
    for (const slug of [
      "/about-you/your-name",
      "/getting-started/basis-of-eligibility",
      "/additional-information/additional-information",
      "/evidence/form-i-94",
    ]) {
      expect(onTerminalPath(`${BASE}${slug}`), slug).toBe(false);
    }
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

  it("plans the preparer reveal toggles from the firm-driven payload (SOF-892)", () => {
    // The firm's G-28 attorney IS the preparer, so the backend drives the
    // two-question reveal: a preparer IS assisting (opens the preparer section),
    // no interpreter. Each toggle plans as a radio carrying its emitted value.
    const plan = planPageFill(page("/getting-started/preparer-and-interpreter-information"), {
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper": "true",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer": "true",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter": "false",
    });
    expect(plan.map((p) => p.spec.name)).toEqual([
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter",
    ]);
    expect(plan.every((p) => p.spec.kind === "radio")).toBe(true);
    const optionOf = Object.fromEntries(plan.map((p) => [p.spec.name, p.spec.optionValue]));
    expect(
      optionOf["formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper"],
    ).toBe("true");
    expect(
      optionOf["formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer"],
    ).toBe("true");
    expect(
      optionOf["formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter"],
    ).toBe("false");
  });

  it("plans the preparer identity fields from the firm.* payload (SOF-892)", () => {
    // /getting-started/preparer is reached because the reveal toggles are driven
    // Yes. Its fields fill from the firm's G-28 attorney block (the same source
    // the paper I-539 Part 7 uses), in descriptor order.
    const plan = planPageFill(page("/getting-started/preparer"), {
      "gettingStarted.preparer.name.firstName": "Adaikala Mary",
      "gettingStarted.preparer.name.lastName": "Kennedy",
      "gettingStarted.preparer.business": "Law Offices of Mary Kennedy, LLC",
      "gettingStarted.preparer.contact.daytimePhone": "8472201560",
      "gettingStarted.preparer.contact.emailAddress": "legal@mkimmigrationlaw.com",
      // SOF-1004: the mobile IS planned now. This assertion was inverted — it used
      // to require mobile NOT be planned, because when SOF-892 shipped there was no
      // firm mobile to send. The backend now sends firm.mobile_phone, so refusing to
      // plan it is what leaves the required USCIS field blank.
      "gettingStarted.preparer.contact.mobilePhone": "8472200000",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toEqual([
      "gettingStarted.preparer.name.firstName",
      "gettingStarted.preparer.name.lastName",
      "gettingStarted.preparer.business",
      "gettingStarted.preparer.contact.daytimePhone",
      "gettingStarted.preparer.contact.mobilePhone",
      "gettingStarted.preparer.contact.emailAddress",
    ]);
    // The tick is NOT planned here: the payload carries a real mobile, so the
    // backend resolves noMobilePhone to "" and there is nothing to tick. Exactly
    // one of the two ever has a value.
    expect(names).not.toContain(
      "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone",
    );
  });

  it("plans the no-mobile tick instead of the number when the firm has no mobile (SOF-1004)", () => {
    // The other half of the pair. USCIS holds the page on a blank required mobile,
    // so a firm with no mobile on file must tick "my preparer does not have a
    // mobile telephone number" — the backend decides which by resolving both off
    // the same fact, and the descriptor has to be able to drive either one.
    const plan = planPageFill(page("/getting-started/preparer"), {
      "gettingStarted.preparer.name.firstName": "Adaikala Mary",
      "gettingStarted.preparer.name.lastName": "Kennedy",
      "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone": "true",
    });
    const names = plan.map((p) => p.spec.name);
    expect(names).toContain(
      "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone",
    );
    expect(names).not.toContain("gettingStarted.preparer.contact.mobilePhone");
    const tick = plan.find((p) =>
      p.spec.name.endsWith("preparer.contact.noMobilePhone"),
    );
    expect(tick?.spec.kind).toBe("checkbox");
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
