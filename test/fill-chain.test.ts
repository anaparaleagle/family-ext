import { describe, it, expect, beforeEach } from "vitest";
import {
  planPageFill,
  repeaterRowCount,
  fillPage,
  waitForPageReady,
  findSaveButton,
} from "../src/runner/fill-chain";
import { I130_PAGES } from "../src/i130/form-descriptor";
import { findByName } from "../src/engine/value-setter";
import { setBody, textInput, radioGroup, addButton } from "./fixtures/dom";

function page(slug: string) {
  const p = I130_PAGES.find((x) => x.slug === slug);
  if (!p) throw new Error(`no page ${slug}`);
  return p;
}

describe("planPageFill (pure)", () => {
  it("omits fields with no payload value and empty strings", () => {
    const p = page("/about-you/your-name");
    const plan = planPageFill(p, {
      "applicant.yourName.name.firstName": "Daniel",
      "applicant.yourName.name.middleName": "",
      // lastName absent entirely
    });
    const names = plan.map((x) => x.spec.name);
    expect(names).toContain("applicant.yourName.name.firstName");
    expect(names).not.toContain("applicant.yourName.name.middleName");
    expect(names).not.toContain("applicant.yourName.name.lastName");
  });

  it("orders radios first, then country, then state, then the rest", () => {
    const p = page("/about-you/your-contact-information");
    const plan = planPageFill(p, {
      "applicant.yourContactInformation.mailingAddress.country": "United States",
      "applicant.yourContactInformation.mailingAddress.state": "Texas",
      "applicant.yourContactInformation.mailingAddress.city": "Austin",
      "applicant.yourContactInformation.isMailingEqualToPhysical": "true",
    });
    const names = plan.map((x) => x.spec.name);
    const radioIdx = names.indexOf("applicant.yourContactInformation.isMailingEqualToPhysical");
    const countryIdx = names.indexOf("applicant.yourContactInformation.mailingAddress.country");
    const stateIdx = names.indexOf("applicant.yourContactInformation.mailingAddress.state");
    const cityIdx = names.indexOf("applicant.yourContactInformation.mailingAddress.city");
    expect(radioIdx).toBeLessThan(countryIdx);
    expect(countryIdx).toBeLessThan(stateIdx);
    expect(stateIdx).toBeLessThan(cityIdx);
  });
});

describe("repeaterRowCount (pure)", () => {
  it("counts contiguous rows the payload supplies", () => {
    const p = page("/about-you/your-address-history");
    const count = repeaterRowCount(p.repeater!, p.fields, {
      "applicant.yourAddressHistory.0.address.addressLineOne": "1 Main St",
      "applicant.yourAddressHistory.0.dates.fromDate": "01/01/2020",
      "applicant.yourAddressHistory.1.address.addressLineOne": "2 Oak Ave",
    });
    expect(count).toBe(2);
  });

  it("returns 0 when no row has data", () => {
    const p = page("/about-you/your-address-history");
    expect(repeaterRowCount(p.repeater!, p.fields, {})).toBe(0);
  });

  it("expands {i} into one plan entry set per row", () => {
    const p = page("/about-you/your-address-history");
    const plan = planPageFill(p, {
      "applicant.yourAddressHistory.0.address.city": "Austin",
      "applicant.yourAddressHistory.1.address.city": "Dallas",
    });
    const cities = plan.filter((x) => x.spec.name.endsWith("address.city")).map((x) => x.spec.name);
    expect(cities).toEqual([
      "applicant.yourAddressHistory.0.address.city",
      "applicant.yourAddressHistory.1.address.city",
    ]);
  });
});

describe("findSaveButton (repeater commit)", () => {
  beforeEach(() => setBody(""));

  it('finds a "Save Entry" commit button', () => {
    setBody('<button type="button">Save Entry</button>');
    expect(findSaveButton()?.textContent).toBe("Save Entry");
  });

  it('finds "Save and continue" / "Save & continue"', () => {
    setBody('<button>Save and continue</button>');
    expect(findSaveButton()).not.toBeNull();
    setBody('<button>Save &amp; continue</button>');
    expect(findSaveButton()).not.toBeNull();
  });

  it('falls back to a bare "Save" that is not a leave-the-form action', () => {
    setBody('<button>Save</button>');
    expect(findSaveButton()?.textContent).toBe("Save");
  });

  it('ignores leave-the-form saves ("Save and exit", "Save draft", "Save for later")', () => {
    setBody(
      '<button>Save and exit</button>' +
        "<button>Save draft</button>" +
        "<button>Save for later</button>",
    );
    expect(findSaveButton()).toBeNull();
  });

  it("prefers the in-form Save Entry over a header Save-and-exit", () => {
    setBody(
      '<header><button>Save and exit</button></header>' +
        '<button type="button">Save Entry</button>',
    );
    expect(findSaveButton()?.textContent).toBe("Save Entry");
  });

  it("excludes save buttons inside the global nav/sidebar", () => {
    setBody('<nav><button>Save</button></nav>');
    expect(findSaveButton()).toBeNull();
  });

  it("returns null when there is no save button", () => {
    setBody('<button data-testid="next-button">Next</button>');
    expect(findSaveButton()).toBeNull();
  });
});

describe("fillPage (DOM)", () => {
  beforeEach(() => setBody(""));

  it("fills a simple page's fields by name", async () => {
    setBody(
      textInput("applicant.yourName.name.firstName") +
        textInput("applicant.yourName.name.middleName") +
        textInput("applicant.yourName.name.lastName"),
    );
    const res = await fillPage(page("/about-you/your-name"), {
      "applicant.yourName.name.firstName": "Daniel",
      "applicant.yourName.name.middleName": "R",
      "applicant.yourName.name.lastName": "Okafor",
    });
    expect(res.filled).toBe(3);
    expect((findByName("applicant.yourName.name.lastName") as HTMLInputElement).value).toBe("Okafor");
  });

  it("fills radios first then text on a mixed page", async () => {
    setBody(
      radioGroup("applicant.additionalInformation.immigrationStatus", [
        { value: "4", label: "US Citizen" },
        { value: "11", label: "LPR" },
      ]) +
        textInput("applicant.additionalInformation.alienNumber.number") +
        textInput("applicant.additionalInformation.dateOfBirth"),
    );
    const res = await fillPage(page("/about-you/your-additional-information"), {
      "applicant.additionalInformation.immigrationStatus": "4",
      "applicant.additionalInformation.alienNumber.number": "A123456789",
      "applicant.additionalInformation.dateOfBirth": "05/05/1985",
    });
    expect(res.filled).toBe(3);
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="applicant.additionalInformation.immigrationStatus"]:checked',
    );
    expect(checked?.value).toBe("4");
  });

  it("waits for a not-yet-rendered page's first field before resolving", async () => {
    setBody(""); // page hasn't mounted its inputs yet
    const p = page("/about-you/your-name");
    const fieldValues = { "applicant.yourName.name.firstName": "Daniel" };
    // The input appears ~300ms later (simulating a React first-paint race).
    setTimeout(() => setBody(textInput("applicant.yourName.name.firstName")), 300);

    const start = Date.now();
    await waitForPageReady(p, fieldValues, 3000);
    const elapsed = Date.now() - start;

    // It waited until the field rendered, then resolved (well before the cap).
    expect(findByName("applicant.yourName.name.firstName")).not.toBeNull();
    expect(elapsed).toBeLessThan(3000);
  });

  it("returns immediately when the page has no payload values (0/0)", async () => {
    setBody("");
    const start = Date.now();
    await waitForPageReady(page("/about-you/your-name"), {}, 3000);
    // An empty plan must not stall — no fields to wait for.
    expect(Date.now() - start).toBeLessThan(150);
  });

  it("clicks Add then fills indexed repeater rows", async () => {
    // Row 0 is pre-rendered; clicking Add reveals row 1 (simulated by a handler).
    setBody(
      textInput("applicant.yourAddressHistory.0.address.city") +
        addButton("Add address") +
        '<div id="slot"></div>',
    );
    const btn = document.querySelector("button")!;
    btn.addEventListener("click", () => {
      const slot = document.getElementById("slot")!;
      if (!slot.querySelector('[name="applicant.yourAddressHistory.1.address.city"]')) {
        slot.innerHTML = textInput("applicant.yourAddressHistory.1.address.city");
      }
    });

    const res = await fillPage(page("/about-you/your-address-history"), {
      "applicant.yourAddressHistory.0.address.city": "Austin",
      "applicant.yourAddressHistory.1.address.city": "Dallas",
    });
    expect(res.filled).toBe(2);
    expect((findByName("applicant.yourAddressHistory.1.address.city") as HTMLInputElement).value).toBe("Dallas");
  });
});
