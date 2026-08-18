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

  it("RECOVERS from a punctuation-only difference instead of failing", async () => {
    // BEHAVIOUR CHANGED 2026-07-29, deliberately. This used to assert the miss
    // failed with a diagnostic naming the difference. The live run proved the
    // difference class is recoverable, so now we recover: labelKey collapses
    // case/punctuation/spacing, so "Spouse Or Child Of F 1." selects the live
    // "Spouse or Child of F-1.". Failing and explaining was the right behaviour
    // only while we could not tell which repair was correct.
    autocomplete("gettingStarted.reasonForRequest.statusInfo.changeOfStatus", [
      "Spouse or Child of F-1.",
      "Temporary Visitor For Pleasure.",
    ]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    const res = await setValue(
      { name: "gettingStarted.reasonForRequest.statusInfo.changeOfStatus", kind: "search" },
      "Spouse Or Child Of F 1.",
    );
    expect(res.success).toBe(true);
    expect(clicked).toBe("Spouse or Child of F-1.");
  }, 20000);

  it("selects a `CODE - Description` option from the Description alone", async () => {
    // THE LIVE FAILURE, 2026-07-29: every I-539 status option is labelled
    // "F1 - Student, ..." and we store only the Description, so typing it renders
    // ZERO options (myUSCIS filters the whole label from its start).
    autocomplete("gettingStarted.reasonForRequest.statusInfo.changeOfStatus", [
      "F1 - Student, Academic Or Language Program.",
      "F2 - Spouse Or Child Of F 1.",
    ]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    const res = await setValue(
      { name: "gettingStarted.reasonForRequest.statusInfo.changeOfStatus", kind: "search" },
      "Student, Academic Or Language Program.",
    );
    expect(res.success).toBe(true);
    expect(clicked).toBe("F1 - Student, Academic Or Language Program.");
  }, 20000);

  it("selects an all-caps value against its correctly-cased option", async () => {
    // The other half of the same live failure: our fact held "INDIA" (OCR), the
    // live option is "India", and myUSCIS's filter is CASE-SENSITIVE — so the
    // value filtered its own option off the screen.
    autocomplete("passport.countryOfIssuance", ["India", "Indonesia"]);
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    const res = await setValue({ name: "passport.countryOfIssuance", kind: "search" }, "INDIA");
    expect(res.success).toBe(true);
    // NOT Indonesia — an exact key match must beat a mere prefix.
    expect(clicked).toBe("India");
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

// An autocomplete that ALREADY HOLDS A VALUE, with a list that filters on what is
// actually in the box — which is what MUI does and what the static lists above
// never exercised. This is the shape that failed live on the N-400 contact page
// (SOF-1312): physicalAddress.state held "New York", the case said "Illinois",
// and the run reported 15/17 filled while leaving the WRONG state on the form.
//
// From the extension's own diagnostic on that run:
//   we typed: "Illinois" (8 chars)
//   options rendered after typing that: 1
//   options on screen (1):  "New York"
//   VERDICT: nothing resembling this value is in the list at all.
//
// The matcher was fine. The QUERY was wrong: typeInto could not clear the box, so
// the widget went on filtering against its old value and never offered Illinois.
// Silently keeping a wrong answer is worse than leaving a field blank, because
// nothing downstream can tell it happened.
describe("value-setter: search on a field that already has a value", () => {
  beforeEach(() => setBody(""));

  /**
   * A search input whose option list filters on the input's CURRENT value, and
   * which commits the clicked option — the two behaviours a real Autocomplete has
   * and a static fixture does not.
   */
  function filteringAutocomplete(name: string, committed: string, all: string[]): HTMLInputElement {
    setBody(
      `<input type="text" name="${name}" id="${name}" value="${committed}" />` +
        `<ul role="listbox" id="lb"></ul>`,
    );
    const el = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    const lb = document.getElementById("lb")!;
    const render = (): void => {
      const q = el.value.trim().toLowerCase();
      lb.innerHTML = all
        .filter((o) => o.toLowerCase().startsWith(q))
        .map((o) => `<li role="option">${o}</li>`)
        .join("");
      for (const opt of Array.from(lb.querySelectorAll('[role="option"]'))) {
        opt.addEventListener("click", () => {
          el.value = opt.textContent || "";
          render();
        });
      }
    };
    el.addEventListener("input", render);
    render();
    return el;
  }

  const STATES = ["New York", "New Jersey", "Illinois", "Indiana"];

  it("replaces the old value instead of filtering the list against it", async () => {
    const el = filteringAutocomplete("addr.state", "New York", STATES);
    const res = await setValue({ name: "addr.state", kind: "search" }, "Illinois");
    expect(res.success, "the autocomplete kept its old value").toBe(true);
    expect(el.value).toBe("Illinois");
  });

  it("still works when the field starts empty", async () => {
    // Non-vacuity: the blank case is the one that already worked, and it must keep
    // working — a fix that only handles the pre-filled case is half a fix.
    const el = filteringAutocomplete("addr.state", "", STATES);
    const res = await setValue({ name: "addr.state", kind: "search" }, "Indiana");
    expect(res.success).toBe(true);
    expect(el.value).toBe("Indiana");
  });

  it("leaves the old value alone when the target genuinely is not in the list", async () => {
    // Clearing the box must not become a way to silently wipe an answer: if we
    // cannot commit our value, the field must still hold what the client had.
    const el = filteringAutocomplete("addr.state", "New York", STATES);
    const res = await setValue({ name: "addr.state", kind: "search" }, "Atlantis");
    expect(res.success).toBe(false);
    expect(el.value, "a failed match must not blank the field").toBe("New York");
  });
});
