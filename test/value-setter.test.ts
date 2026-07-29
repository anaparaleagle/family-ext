import { describe, it, expect, beforeEach } from "vitest";
import { setValue, findByName, labelKey } from "../src/engine/value-setter";
import { debugLog, resetDebugLog } from "../src/engine/logger";
import { setBody, textInput, radioGroup, checkbox, select } from "./fixtures/dom";

describe("value-setter: text", () => {
  beforeEach(() => setBody(""));

  it("sets a plain text field by its Formik name", async () => {
    setBody(textInput("applicant.yourName.name.firstName"));
    const res = await setValue(
      { name: "applicant.yourName.name.firstName", kind: "text" },
      "Daniel",
    );
    expect(res.success).toBe(true);
    const el = findByName("applicant.yourName.name.firstName") as HTMLInputElement;
    expect(el.value).toBe("Daniel");
  });

  it("reports failure when the element is not on the page", async () => {
    setBody("");
    const res = await setValue({ name: "applicant.nope", kind: "text" }, "x");
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/not on page/);
  });

  it("handles dotted names with numeric repeater indices", async () => {
    setBody(textInput("applicant.yourAddressHistory.0.address.city"));
    const res = await setValue(
      { name: "applicant.yourAddressHistory.0.address.city", kind: "text" },
      "Austin",
    );
    expect(res.success).toBe(true);
    expect((findByName("applicant.yourAddressHistory.0.address.city") as HTMLInputElement).value).toBe("Austin");
  });
});

describe("value-setter: radio", () => {
  beforeEach(() => setBody(""));

  it("selects the radio option whose value matches the coded backend value", async () => {
    // describe-yourself gender: male=1, female=3 (from the dump's option codes).
    setBody(
      radioGroup("applicant.i130DescribeYourself.gender", [
        { value: "3", label: "Female" },
        { value: "1", label: "Male" },
      ]),
    );
    const res = await setValue(
      { name: "applicant.i130DescribeYourself.gender", kind: "radio", optionValue: "1" },
      "1",
    );
    expect(res.success).toBe(true);
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="applicant.i130DescribeYourself.gender"]:checked',
    );
    expect(checked?.value).toBe("1");
  });

  it("aliases true/false to yes/no labels", async () => {
    setBody(
      radioGroup("applicant.yourContactInformation.isMailingEqualToPhysical", [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]),
    );
    const res = await setValue(
      { name: "applicant.yourContactInformation.isMailingEqualToPhysical", kind: "radio" },
      "true",
    );
    expect(res.success).toBe(true);
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="applicant.yourContactInformation.isMailingEqualToPhysical"]:checked',
    );
    expect(checked?.value).toBe("yes");
  });

  it("reports failure when no option matches", async () => {
    setBody(
      radioGroup("applicant.additionalInformation.immigrationStatus", [
        { value: "4", label: "US Citizen" },
        { value: "11", label: "LPR" },
      ]),
    );
    const res = await setValue(
      { name: "applicant.additionalInformation.immigrationStatus", kind: "radio", optionValue: "99" },
      "99",
    );
    expect(res.success).toBe(false);
  });
});

describe("value-setter: checkbox", () => {
  beforeEach(() => setBody(""));

  it("checks a checkbox for a truthy value", async () => {
    setBody(checkbox("applicant.i130DescribeYourself.ethnicity"));
    const res = await setValue(
      { name: "applicant.i130DescribeYourself.ethnicity", kind: "checkbox" },
      "1",
    );
    expect(res.success).toBe(true);
    expect((findByName("applicant.i130DescribeYourself.ethnicity") as HTMLInputElement).checked).toBe(true);
  });

  it("leaves a checkbox unchecked for a falsy value", async () => {
    setBody(checkbox("applicant.i130DescribeYourself.ethnicity"));
    const res = await setValue(
      { name: "applicant.i130DescribeYourself.ethnicity", kind: "checkbox" },
      "",
    );
    expect(res.success).toBe(true);
    expect((findByName("applicant.i130DescribeYourself.ethnicity") as HTMLInputElement).checked).toBe(false);
  });
});

describe("value-setter: select", () => {
  beforeEach(() => setBody(""));

  it("selects an option by value", async () => {
    setBody(
      select("some.dropdown", [
        { value: "", label: "- Select -" },
        { value: "TX", label: "Texas" },
        { value: "CA", label: "California" },
      ]),
    );
    const res = await setValue({ name: "some.dropdown", kind: "select" }, "TX");
    expect(res.success).toBe(true);
    expect((findByName("some.dropdown") as HTMLSelectElement).value).toBe("TX");
  });

  it("selects an option by visible label", async () => {
    setBody(
      select("some.dropdown", [
        { value: "1", label: "Texas" },
        { value: "2", label: "California" },
      ]),
    );
    const res = await setValue({ name: "some.dropdown", kind: "select" }, "California");
    expect(res.success).toBe(true);
    expect((findByName("some.dropdown") as HTMLSelectElement).value).toBe("2");
  });
});

describe("value-setter: search (MUI Autocomplete)", () => {
  beforeEach(() => setBody(""));

  /** A search input plus a static option list (happy-dom won't run MUI's filter,
   * so we render the options the page would show and assert which one is clicked). */
  function autocomplete(name: string, options: string[]): void {
    const opts = options
      .map((o, i) => `<li role="option" data-i="${i}">${o}</li>`)
      .join("");
    setBody(
      `<input type="text" name="${name}" id="${name}" />` +
        `<ul role="listbox">${opts}</ul>`,
    );
  }

  it("matches an exact country option, not an earlier-sorting partial", async () => {
    autocomplete("addr.country", ["United Arab Emirates", "United States", "United Kingdom"]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    const res = await setValue({ name: "addr.country", kind: "search" }, "United States");
    expect(res.success).toBe(true);
    expect(clicked).toBe("United States");
  });

  it("does NOT mid-word substring match (the live USA -> Jerusalem trap)", async () => {
    // The old `.includes` matched "USA" inside "Jerusalem". The word-boundary
    // Pass 3 must reject that, so a bare "USA" with no whole-word match fails
    // rather than silently picking a wrong country.
    autocomplete("addr.country", ["Jerusalem", "Japan", "Jamaica"]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    const res = await setValue({ name: "addr.country", kind: "search" }, "USA");
    expect(res.success).toBe(false);
    expect(clicked).toBe("");
  });

  it("whole-word match still works (value is a complete token in the label)", async () => {
    autocomplete("addr.state", ["New York", "York"]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    // "York" is a whole word in "New York" too, but exact match wins first.
    const res = await setValue({ name: "addr.state", kind: "search" }, "York");
    expect(res.success).toBe(true);
    expect(clicked).toBe("York");
  });
});

describe("value-setter: phone", () => {
  beforeEach(() => setBody(""));

  it("strips formatting and a leading country 1", async () => {
    setBody(textInput("applicant.yourContactInformation.contactInformation.mobilePhoneNumber.intlNumber"));
    const res = await setValue(
      {
        name: "applicant.yourContactInformation.contactInformation.mobilePhoneNumber.intlNumber",
        kind: "phone",
      },
      "+1 (512) 555-0143",
    );
    expect(res.success).toBe(true);
    const el = findByName(
      "applicant.yourContactInformation.contactInformation.mobilePhoneNumber.intlNumber",
    ) as HTMLInputElement;
    expect(el.value).toBe("5125550143");
  });
});

// ===========================================================================
// THE AUTOCOMPLETE MISS DIAGNOSTIC
//
// A miss on the change-to status picker leaves the single most important answer
// on an I-539 unset, and the two possible causes need OPPOSITE fixes: our value
// is wrong (fix the captured table + the backend transform) or the matcher/typing
// over-filters (fix the extension). Guessing costs a whole live run.
//
// So a miss must put the evidence in the log: what we typed, what the page
// actually offered, and — when the difference is only punctuation or spacing —
// both strings side by side. These lock that, because a diagnostic nobody has
// tested is worth nothing at the moment it is needed.
// ===========================================================================

describe("value-setter: diagnosing an autocomplete miss", () => {
  beforeEach(() => {
    setBody("");
    resetDebugLog();
  });

  function autocomplete(name: string, options: string[]): void {
    const opts = options.map((o, i) => `<li role="option" data-i="${i}">${o}</li>`).join("");
    setBody(`<input type="text" name="${name}" id="${name}" /><ul role="listbox">${opts}</ul>`);
  }

  it("collapses punctuation and spacing for comparison only", () => {
    expect(labelKey("Spouse Or Child Of F 1.")).toBe(labelKey("Spouse or Child of F-1."));
    expect(labelKey("Spouse Or Child Of F 1.")).toBe(labelKey("spouse  or child  of  f1"));
    // Different letters must NOT collapse together.
    expect(labelKey("Spouse Or Child Of F 1.")).not.toBe(labelKey("Spouse Or Child Of M 1."));
  });

  it("logs the live labels and names the punctuation difference", async () => {
    // The live page says "F-1" with a hyphen; our captured table says "F 1".
    autocomplete("gettingStarted.reasonForRequest.statusInfo.changeOfStatus", [
      "Spouse or Child of F-1.",
      "Temporary Visitor For Pleasure.",
    ]);
    const res = await setValue(
      { name: "gettingStarted.reasonForRequest.statusInfo.changeOfStatus", kind: "search" },
      "Spouse Or Child Of F 1.",
    );
    expect(res.success).toBe(false);

    const log = debugLog.join("\n");
    // What we sent, quoted so hidden characters are visible.
    expect(log).toContain('we typed: "Spouse Or Child Of F 1."');
    // What the page really offered.
    expect(log).toContain('"Spouse or Child of F-1."');
    // And the verdict that decides which repair to make.
    expect(log).toMatch(/VERDICT: the option IS there but the text differs/);
    expect(log).toMatch(/OUR VALUE IS WRONG/);
  }, 20000);

  it("says so plainly when the value is nowhere in the list", async () => {
    autocomplete("addr.country", ["Japan", "Jamaica"]);
    const res = await setValue({ name: "addr.country", kind: "search" }, "Westeros");
    expect(res.success).toBe(false);
    expect(debugLog.join("\n")).toMatch(/nothing resembling this value is in the list/);
  }, 20000);

  it("reports an EMPTY list as over-filtering, not as a missing option", async () => {
    // No options rendered at all — the shape a live over-filter produces. The
    // distinction matters: an empty list is our typing's fault, a full list that
    // does not match is the value's fault.
    setBody('<input type="text" name="addr.country" id="addr.country" /><ul role="listbox"></ul>');
    const res = await setValue({ name: "addr.country", kind: "search" }, "United States");
    expect(res.success).toBe(false);
    const log = debugLog.join("\n");
    expect(log).toContain("options rendered after typing that: 0");
    expect(log).toMatch(/The list was EMPTY -> what we typed over-filtered it/);
    // And it re-types the first word to recover the labels...
    expect(log).toContain('Re-typing just "United"');
    // ...then puts the input back, so the diagnostic is invisible to the form.
    //
    // Asserted through the log, not through el.value, and the reason matters:
    // typing here goes through document.execCommand, which is a NO-OP under
    // happy-dom, so el.value never changes in this environment and asserting it
    // would prove nothing either way. The log line does guard the thing that
    // could actually regress — someone deleting the restore. The restore itself
    // is only truly exercised in a real browser.
    expect(log).toContain('restored the input to "United States"');
  }, 20000);
});
