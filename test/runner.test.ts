// The form-agnostic runner: the config registry, the "Audit page" diagnostic,
// and the navigation safety guards.

import { describe, it, expect, beforeEach } from "vitest";
import { auditPage, summarizeAudit } from "../src/runner/audit";
import { configForPath, configForFormType, FORM_CONFIGS } from "../src/runner/registry";
import { findNextButton, isForbiddenAdvanceControl, onLoginPage } from "../src/runner/fill-chain";
import { I130_PAGES } from "../src/i130/form-descriptor";
import { I539_PAGES } from "../src/i539/form-descriptor";
import { FormPage } from "../src/runner/types";
import { setBody, textInput, radioGroup } from "./fixtures/dom";

describe("form config registry", () => {
  it("routes an I-130 form URL to the I-130 config", () => {
    const c = configForPath("/forms/petition-for-a-relative/12993840/about-you/your-name");
    expect(c?.formType).toBe("I-130");
    expect(c?.pages).toBe(I130_PAGES);
  });

  it("routes an I-539 form URL to the I-539 config", () => {
    const c = configForPath(
      "/forms/application-to-extend-change-nonimmigrant-status/13212561/about-you/your-name",
    );
    expect(c?.formType).toBe("I-539");
    expect(c?.pages).toBe(I539_PAGES);
  });

  it("returns null off a supported form (account pages, other forms)", () => {
    expect(configForPath("/account/dashboard")).toBeNull();
    expect(configForPath("/forms/some-other-form/123/page")).toBeNull();
  });

  it("looks a config up by backend form_type", () => {
    expect(configForFormType("I-539")?.hostPath).toBe(
      "/forms/application-to-extend-change-nonimmigrant-status/",
    );
    expect(configForFormType("I-485")).toBeNull();
  });

  it("keeps every config's host path distinct (no ambiguous routing)", () => {
    const paths = FORM_CONFIGS.map((c) => c.hostPath);
    expect(new Set(paths).size).toBe(paths.length);
    // No host path may be a substring of another, or configForPath's first-match
    // would silently pick the wrong form.
    for (const a of paths) {
      for (const b of paths) {
        if (a !== b) expect(a.includes(b)).toBe(false);
      }
    }
  });
});

describe("navigation safety: never click Submit/Pay/e-sign", () => {
  beforeEach(() => setBody(""));

  it.each([
    "Submit",
    "Submit application",
    "Pay and submit",
    "Continue to payment",
    "E-Sign",
    "Sign and submit",
    "Checkout",
  ])('refuses "%s" as an advance control', (label) => {
    setBody(`<button data-testid="next-button">${label}</button>`);
    expect(findNextButton()).toBeNull();
  });

  it("still finds an ordinary Next button", () => {
    setBody('<button data-testid="next-button">Next</button>');
    expect(findNextButton()?.textContent).toBe("Next");
  });

  it("still finds an ordinary Continue button", () => {
    setBody("<button>Continue</button>");
    expect(findNextButton()?.textContent).toBe("Continue");
  });

  it("flags forbidden controls directly", () => {
    setBody("<button>Pay now</button>");
    expect(isForbiddenAdvanceControl(document.querySelector("button"))).toBe(true);
    expect(isForbiddenAdvanceControl(null)).toBe(false);
  });
});

describe("login/redirect detection", () => {
  beforeEach(() => setBody(""));

  it("treats a page with a password field as signed out", () => {
    setBody('<input type="password" name="password" />');
    expect(onLoginPage()).toBe(true);
  });

  it("does not flag an ordinary form page", () => {
    setBody(textInput("applicant.yourName.name.firstName"));
    expect(onLoginPage()).toBe(false);
  });
});

// ── Audit ───────────────────────────────────────────────────────────────────

const auditFixture: FormPage = {
  slug: "/about-you/your-name",
  title: "Your name",
  kind: "form",
  fields: [
    { name: "applicant.yourName.name.firstName", kind: "text" },
    { name: "applicant.yourName.name.lastName", kind: "text" },
    { name: "applicant.yourName.name.suffix", kind: "text", conditional: true },
  ],
};

describe("auditPage", () => {
  beforeEach(() => setBody(""));

  it("reports descriptor fields that ARE on the page as present", () => {
    setBody(
      textInput("applicant.yourName.name.firstName") + textInput("applicant.yourName.name.lastName"),
    );
    const audit = auditPage(auditFixture);
    expect(audit.present).toEqual([
      "applicant.yourName.name.firstName",
      "applicant.yourName.name.lastName",
    ]);
  });

  it("reports an unconditional descriptor field absent from the DOM as missing, and says it looks like a rename", () => {
    // This is the drift signal we built the button for: USCIS renamed lastName.
    setBody(textInput("applicant.yourName.name.firstName"));
    const audit = auditPage(auditFixture);
    expect(audit.missing).toContain("applicant.yourName.name.lastName");
    expect(audit.notes.join(" ")).toMatch(/rename/i);
  });

  it("explains a missing CONDITIONAL field instead of crying wolf", () => {
    setBody(
      textInput("applicant.yourName.name.firstName") + textInput("applicant.yourName.name.lastName"),
    );
    const audit = auditPage(auditFixture);
    expect(audit.missing).toEqual(["applicant.yourName.name.suffix"]);
    expect(audit.notes.join(" ")).toMatch(/conditional reveals/i);
    // A conditional absence must NOT be reported as a rename.
    expect(audit.notes.join(" ")).not.toMatch(/rename/i);
  });

  it("reports Formik fields the descriptor never mentions as extra", () => {
    setBody(
      textInput("applicant.yourName.name.firstName") +
        textInput("applicant.yourName.name.lastName") +
        textInput("applicant.yourName.name.newFieldUscisAdded"),
    );
    const audit = auditPage(auditFixture);
    expect(audit.extra).toEqual(["applicant.yourName.name.newFieldUscisAdded"]);
    expect(audit.notes.join(" ")).toMatch(/not in the descriptor/i);
  });

  it("ignores page chrome that is not a Formik path", () => {
    setBody(
      textInput("applicant.yourName.name.firstName") +
        textInput("applicant.yourName.name.lastName") +
        '<input type="search" name="sitesearch" />',
    );
    expect(auditPage(auditFixture).extra).toEqual([]);
  });

  it("collapses a radio group's shared name to one entry", () => {
    const page: FormPage = {
      slug: "/x",
      title: "X",
      kind: "form",
      fields: [{ name: "applicant.gender", kind: "radio", options: ["3", "1"] }],
    };
    setBody(
      radioGroup("applicant.gender", [
        { value: "3", label: "Male" },
        { value: "1", label: "Female" },
      ]),
    );
    const audit = auditPage(page);
    expect(audit.present).toEqual(["applicant.gender"]);
    expect(audit.extra).toEqual([]);
  });

  it("matches any indexed instance of a repeater template", () => {
    const page: FormPage = {
      slug: "/additional-information/additional-information",
      title: "Additional information",
      kind: "form",
      repeater: { namePrefix: "additionalInformationArray", addButtonText: "add a response" },
      fields: [{ name: "additionalInformationArray.{i}.section", kind: "text" }],
    };
    // Rows 0 and 3 exist; neither should count as "extra", and the template is present.
    setBody(
      textInput("additionalInformationArray.0.section") +
        textInput("additionalInformationArray.3.section"),
    );
    const audit = auditPage(page);
    expect(audit.present).toEqual(["additionalInformationArray.{i}.section"]);
    expect(audit.extra).toEqual([]);
  });

  it("explains that repeater rows are legitimately absent before Add is clicked", () => {
    const page: FormPage = {
      slug: "/additional-information/additional-information",
      title: "Additional information",
      kind: "form",
      repeater: { namePrefix: "additionalInformationArray", addButtonText: "add a response" },
      fields: [{ name: "additionalInformationArray.{i}.section", kind: "text" }],
    };
    setBody(""); // no rows added yet
    const audit = auditPage(page);
    expect(audit.missing).toEqual(["additionalInformationArray.{i}.section"]);
    expect(audit.notes.join(" ")).toMatch(/Add.*clicked/i);
    expect(audit.notes.join(" ")).not.toMatch(/rename/i);
  });

  it("summarizes counts for the toolbar status", () => {
    setBody(textInput("applicant.yourName.name.firstName"));
    expect(summarizeAudit(auditPage(auditFixture))).toBe("Your name: 1 present, 2 missing, 0 extra");
  });
});
