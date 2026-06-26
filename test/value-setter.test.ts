import { describe, it, expect, beforeEach } from "vitest";
import { setValue, findByName } from "../src/engine/value-setter";
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
