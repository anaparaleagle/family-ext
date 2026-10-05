import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  planPageFill,
  repeaterRowCount,
  fillPage,
  waitForPageReady,
  findSaveButton,
  findRowCommitButton,
  findConfirmationButton,
  isForbiddenAdvanceControl,
  fillAll,
  onTerminalPath,
  type UploadWalkContext,
} from "../src/runner/fill-chain";
import { configForFormType } from "../src/runner/registry";
import { debugLog, resetDebugLog } from "../src/engine/logger";
import { I485J_BASE, I485J_SLUGS } from "./fixtures/i485j-inferred";
import { I130_PAGES } from "../src/i130/form-descriptor";
import { findByName } from "../src/engine/value-setter";
import { setBody, textInput, radioGroup, addButton, checkbox } from "./fixtures/dom";
import { cond, radio, t, FormPage, FormConfig } from "../src/runner/types";

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

describe("findRowCommitButton (a page's own advance button)", () => {
  beforeEach(() => setBody(""));

  it('finds "Add Client" and does not read it as a submit/pay control', () => {
    setBody('<button type="button">Add Client</button>');
    const btn = findRowCommitButton("Add Client");
    expect(btn?.textContent).toBe("Add Client");
    expect(isForbiddenAdvanceControl(btn)).toBe(false);
  });

  it("returns null when the declared button is not on the page", () => {
    setBody('<button data-testid="next-button" disabled>Next</button>');
    expect(findRowCommitButton("Add Client")).toBeNull();
  });

  it('finds the "Okay" that dismisses a confirmation, and never a Continue', () => {
    // Add Client answers with "Your client has been successfully added" + Okay
    // rather than navigating; waiting for a page change there costs 20s.
    setBody('<div role="alert">Your client has been successfully added</div><button>Okay</button>');
    expect(findConfirmationButton()?.textContent).toBe("Okay");
    setBody('<button>Continue</button>');
    expect(findConfirmationButton()).toBeNull();
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

// ===========================================================================
// CONDITIONAL FIELDS ON THE PAGE ITSELF
//
// Three outcomes that must stay distinct, because they need opposite responses:
//   - conditional, no declared reveal, not on the page  -> skip quietly
//   - conditional, reveal WAS driven, still not there   -> a real failure
//   - not conditional, not on the page                  -> a real failure
//
// Collapsing the first into a failure is what made a correct run read as broken
// (five address fields "FAIL element not on page" on a case where the block was
// legitimately shut). Collapsing the second into a skip would have HIDDEN the
// premium radio and the address bug — the block genuinely should have been there.
// ===========================================================================

describe("fillPage — conditional fields", () => {
  beforeEach(() => setBody(""));

  const contactPage: FormPage = {
    slug: "/synthetic/contact",
    title: "Contact",
    kind: "form",
    fields: [
      t("applicant.mailingAddress.city"),
      cond(t("applicant.physicalAddress.city")),
      cond(t("applicant.physicalAddress.zipCode")),
    ],
  };

  it("skips an undeclared conditional that is not on the page, without failing it", async () => {
    setBody(textInput("applicant.mailingAddress.city"));
    const res = await fillPage(contactPage, {
      "applicant.mailingAddress.city": "Austin",
      "applicant.physicalAddress.city": "Austin",
      "applicant.physicalAddress.zipCode": "78701",
    });
    expect(res.filled).toBe(1);
    expect(res.failed).toBe(0); // the two hidden conditionals are NOT failures
    expect(res.skipped).toBe(2);
    expect(res.total).toBe(1); // only the shown field is counted
  });

  it("fills a conditional field once it IS revealed", async () => {
    setBody(
      textInput("applicant.mailingAddress.city") + textInput("applicant.physicalAddress.city"),
    );
    const res = await fillPage(contactPage, {
      "applicant.mailingAddress.city": "Austin",
      "applicant.physicalAddress.city": "Dallas",
      "applicant.physicalAddress.zipCode": "78701", // still hidden -> skipped
    });
    expect(res.filled).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.failed).toBe(0);
  });

  it("still counts a NON-conditional absent field as a failure", async () => {
    setBody(textInput("applicant.mailingAddress.city"));
    const plainPage: FormPage = {
      slug: "/synthetic/plain",
      title: "Plain",
      kind: "form",
      fields: [t("applicant.mailingAddress.city"), t("applicant.mailingAddress.state")],
    };
    const res = await fillPage(plainPage, {
      "applicant.mailingAddress.city": "Austin",
      "applicant.mailingAddress.state": "TX", // element not on page -> a real FAIL
    });
    expect(res.filled).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.skipped).toBe(0);
  });

  // The one that must stay LOUD. We answered the question that opens the block,
  // and the input still is not there — the descriptor is wrong or USCIS changed
  // the form. Reporting that as a quiet skip is how nine unfilled fields went
  // unnoticed for weeks.
  it("FAILS a declared-reveal field that never appears, rather than skipping it", async () => {
    const declaredPage: FormPage = {
      slug: "/synthetic/declared",
      title: "Declared",
      kind: "form",
      fields: [
        radio("applicant.sameAddress", ["true", "false"]),
        cond(t("applicant.physicalAddress.city"), { by: "applicant.sameAddress", is: "false" }),
      ],
    };
    // The radio is present and answered "false", but the revealed input is absent.
    setBody(
      radioGroup("applicant.sameAddress", [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]),
    );
    const res = await fillPage(declaredPage, {
      "applicant.sameAddress": "false",
      "applicant.physicalAddress.city": "Austin",
    });
    expect(res.filled).toBe(1); // the radio
    expect(res.failed).toBe(1); // the revealed field, loudly
    expect(res.skipped).toBe(0); // NOT swept under the carpet
  }, 20000);
});

// ===========================================================================
// THE WALK TELLS THE UPLOAD STEP WHICH EVIDENCE PAGES IT NEVER REACHED
//
// myUSCIS renders some evidence pages only for some answers. A document routed
// to such a page has no other way onto the filing than the Additional-evidence
// catch-all — and only the walk knows which earlier upload pages it never landed
// on. So every upload callback receives that list; the catch-all page is the one
// that acts on it (see doc-flow.strayDescriptors).
// ===========================================================================
describe("fillAll — tells the upload step which evidence pages it never reached", () => {
  const BASE = "https://my.uscis.gov/forms/application-for-naturalization/13375119";
  function goTo(slug: string): void {
    const w = window as unknown as { happyDOM?: { setURL?: (u: string) => void } };
    w.happyDOM?.setURL?.(BASE + slug);
  }
  const upload = (slug: string, extra: Partial<FormPage> = {}): FormPage => ({
    slug,
    title: slug,
    kind: "upload",
    fields: [],
    ...extra,
  });

  it("names the unvisited earlier upload pages when it reaches the catch-all", async () => {
    const greenCard = upload("/evidence/your-permanent-resident-card");
    const support = upload("/evidence/child-and-spousal-support", { conditional: true });
    const catchAll = upload("/evidence/additional-evidence", { catchAll: true });
    goTo(catchAll.slug);
    setBody(`<button data-testid="next-button">Next</button>`);
    const config: FormConfig = {
      formType: "N-400",
      hostPath: "/forms/application-for-naturalization/",
      label: "N-400",
      pages: [greenCard, support, catchAll],
    };
    const onUpload = vi.fn(async () => 0);

    await fillAll(config, {}, onUpload);

    expect(onUpload).toHaveBeenCalledOnce();
    expect(onUpload).toHaveBeenCalledWith(catchAll, {
      unvisitedUploadSlugs: [greenCard.slug, support.slug],
      declaredUploadSlugs: [greenCard.slug, support.slug, catchAll.slug],
    });
  }, 30000);
});

// ===========================================================================
// THE STANDALONE I-485J WALK
//
// Form I-817 is not part of a Supplement J filing, so its page is walked past
// with nothing attached. The walk ends on review and clicks nothing there.
// Slugs are inferred, not captured: see ./fixtures/i485j-inferred.
// ===========================================================================
describe("fillAll — the standalone I-485J", () => {
  function i485jConfig(): FormConfig {
    const config = configForFormType("I-485J");
    expect(config, "no I-485J config registered").not.toBeNull();
    return config!;
  }

  function goToUrl(url: string): void {
    (window.location as unknown as { href: string }).href = url;
  }

  /** Each page's Next navigates to the one after it; returns the review page's click counts. */
  function driveChain(slugs: string[]): { next: number; submit: number } {
    const clicks = { next: 0, submit: 0 };
    let i = 0;
    const mount = (): void => {
      goToUrl(`${I485J_BASE}${slugs[i]}`);
      const last = i === slugs.length - 1;
      setBody(
        `<h1>Step ${i + 1}</h1><button data-testid="next-btn">Next</button>` +
          (last ? `<button id="submit">Submit</button>` : ""),
      );
      const next = document.querySelector<HTMLButtonElement>('[data-testid="next-btn"]')!;
      next.addEventListener("click", () => {
        if (last) {
          clicks.next += 1;
          return;
        }
        i += 1;
        mount();
      });
      document.getElementById("submit")?.addEventListener("click", () => {
        clicks.submit += 1;
      });
    };
    mount();
    return clicks;
  }

  beforeEach(() => resetDebugLog());

  it("walks past the Form I-817 page without uploading anything to it", async () => {
    const config = i485jConfig();
    expect(
      config.pages.some((p) => p.slug === I485J_SLUGS.i817),
      "the I-817 page must be declared, not walked past as an unknown page",
    ).toBe(true);
    driveChain([I485J_SLUGS.i817, I485J_SLUGS.additionalEvidence, I485J_SLUGS.review]);
    const onUpload = vi.fn(async (_page: FormPage, _walk: UploadWalkContext) => 0);

    await fillAll(config, {}, onUpload);

    expect(onUpload.mock.calls.map((c) => c[0].slug)).toEqual([I485J_SLUGS.additionalEvidence]);
    expect(debugLog.join("\n")).not.toMatch(/page not in descriptor/);
    expect(window.location.pathname.endsWith(I485J_SLUGS.review)).toBe(true);
  }, 30000);

  it("stops on the I-485J review page and never clicks Next or Submit there", async () => {
    const config = i485jConfig();
    const last = config.pages[config.pages.length - 1];
    expect(last).toMatchObject({ slug: I485J_SLUGS.review, kind: "review" });
    expect(onTerminalPath(`${I485J_BASE}${I485J_SLUGS.review}`)).toBe(true);
    const clicks = driveChain([I485J_SLUGS.additionalEvidence, I485J_SLUGS.review]);

    await fillAll(config, {}, async () => 0);

    expect(window.location.pathname.endsWith(I485J_SLUGS.review)).toBe(true);
    expect(clicks).toEqual({ next: 0, submit: 0 });
    expect(debugLog.join("\n")).toMatch(/review/i);
  }, 30000);
});

describe("I-130 address history - a list of several addresses", () => {
  const BASE = "https://my.uscis.gov/forms/petition-for-a-relative/13700001";
  const H = "applicant.yourAddressHistory";
  function goTo(slug: string): void {
    const w = window as unknown as { happyDOM?: { setURL?: (u: string) => void } };
    w.happyDOM?.setURL?.(BASE + slug);
  }
  const row = (i: number) =>
    ["addressLineOne", "addressLineTwo", "city", "zipCode"]
      .map((f) => textInput(`${H}.${i}.address.${f}`))
      .join("") +
    textInput(`${H}.${i}.dates.fromDate`) +
    textInput(`${H}.${i}.dates.toDate`);
  const ADDRESSES = [
    ["500 Lake Shore Dr", "Apt 12B", "Chicago", "60611", "05/01/2023", ""],
    ["22 Elm St", "Unit 4", "Naperville", "60540", "02/01/2021", "04/30/2023"],
    ["9 Birch Rd", "", "Aurora", "60505", "07/01/2019", "01/31/2021"],
    ["Flat 3, 14 MG Road", "", "Bengaluru", "560001", "01/01/2017", "06/30/2019"],
  ];
  const payload = (): Record<string, string> => {
    const out: Record<string, string> = {};
    ADDRESSES.forEach(([l1, l2, city, zip, from, to], i) => {
      out[`${H}.${i}.address.addressLineOne`] = l1;
      out[`${H}.${i}.address.addressLineTwo`] = l2;
      out[`${H}.${i}.address.city`] = city;
      out[`${H}.${i}.address.zipCode`] = zip;
      out[`${H}.${i}.dates.fromDate`] = from;
      out[`${H}.${i}.dates.toDate`] = to;
    });
    return out;
  };

  it("commits each row before opening the next, so every address is entered", async () => {
    goTo("/about-you/your-address-history");
    setBody(`<button id="add">Add address</button><button id="save">Save entry</button>`);
    let rowOpen = false;
    let nextIndex = 0;
    const clicks: string[] = [];
    document.getElementById("add")!.addEventListener("click", () => {
      clicks.push("add");
      if (rowOpen) return;
      document.body.insertAdjacentHTML("beforeend", row(nextIndex++));
      rowOpen = true;
    });
    document.getElementById("save")!.addEventListener("click", () => {
      clicks.push("save");
      rowOpen = false;
    });

    const res = await fillPage(page("/about-you/your-address-history"), payload());

    expect(res.failed, "a row after the first never rendered").toBe(0);
    const value = (n: string) => document.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value;
    ADDRESSES.forEach(([l1, l2], i) => {
      expect(value(`${H}.${i}.address.addressLineOne`), `row ${i} street`).toBe(l1);
      if (l2) expect(value(`${H}.${i}.address.addressLineTwo`), `row ${i} unit`).toBe(l2);
    });
    expect(clicks.slice(0, 3)).toEqual(["add", "save", "add"]);
  }, 60000);

  it("commits the open row before Next, so the walk reaches Your Family", async () => {
    goTo("/about-you/your-address-history");
    setBody(row(0) + `<button id="save">Save entry</button><button data-testid="next-button">Next</button>`);
    let rowOpen = true;
    const order: string[] = [];
    document.getElementById("save")!.addEventListener("click", () => {
      order.push("save");
      rowOpen = false;
    });
    document.querySelector<HTMLElement>('[data-testid="next-button"]')!.addEventListener("click", () => {
      order.push("next");
      if (rowOpen) return;
      goTo("/your-family/your-marital-status");
      setBody(
        radioGroup("applicant.maritalStatus.maritalStatus", [
          { value: "1", label: "Single, never married" },
          { value: "2", label: "Married" },
        ]) + `<button data-testid="next-button">Next</button>`,
      );
      document.querySelector<HTMLElement>('[data-testid="next-button"]')!.addEventListener("click", () =>
        goTo("/review-and-submit/review-your-petition"),
      );
    });
    const config: FormConfig = {
      formType: "I-130",
      hostPath: "/forms/petition-for-a-relative/",
      label: "I-130",
      pages: I130_PAGES,
    };

    const summaries = await fillAll(
      config,
      { ...payload(), "applicant.maritalStatus.maritalStatus": "2" },
      async () => 0,
    );

    expect(order[0], "Next was clicked with the address row still open").toBe("save");
    expect(summaries.map((s) => s.slug)).toContain("/your-family/your-marital-status");
    const married = document.querySelector<HTMLInputElement>(
      'input[name="applicant.maritalStatus.maritalStatus"][value="2"]',
    );
    expect(married?.checked, "the walk stopped before Your Family").toBe(true);
  }, 60000);
});

describe("I-130 describe yourself", () => {
  const D = "applicant.i130DescribeYourself";
  const describePage = () => page("/about-you/describe-yourself");
  const RACE = ["5", "2", "3", "6", "1"];

  it("ticks the race boxes the backend sends", async () => {
    setBody(RACE.map((n) => checkbox(n)).join(""));
    await fillPage(describePage(), { "1": "true", "2": "true" });
    const box = (n: string) => document.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
    expect(box("1").checked, "White").toBe(true);
    expect(box("2").checked, "Asian").toBe(true);
    expect(box("3").checked).toBe(false);
  });

  it("selects Not Hispanic or Latino on the ethnicity radio", async () => {
    setBody(
      radioGroup(`${D}.ethnicity`, [
        { value: "1", label: "Hispanic or Latino" },
        { value: "2", label: "Not Hispanic or Latino" },
      ]),
    );
    await fillPage(describePage(), { [`${D}.ethnicity`]: "2" });
    const no = document.querySelector<HTMLInputElement>(`input[name="${D}.ethnicity"][value="2"]`);
    expect(no?.checked).toBe(true);
  });

  it("drives height, eye and hair colour as autocompletes", () => {
    const plan = planPageFill(describePage(), {
      [`${D}.height.feet`]: "5",
      [`${D}.height.inches`]: "9",
      [`${D}.eyeColor`]: "Brown",
      [`${D}.hairColor`]: "Blonde",
    });
    const kind = (n: string) => plan.find((p) => p.spec.name === `${D}.${n}`)?.spec.kind;
    expect(kind("height.feet")).toBe("search");
    expect(kind("height.inches")).toBe("search");
    expect(kind("eyeColor")).toBe("search");
    expect(kind("hairColor")).toBe("search");
  });

  it("picks the eye colour option instead of only typing the text", async () => {
    setBody(
      `<input type="text" name="${D}.eyeColor" id="${D}.eyeColor" />` +
        `<ul role="listbox">${["Black", "Blue", "Brown", "Gray"].map((o) => `<li role="option">${o}</li>`).join("")}</ul>`,
    );
    let clicked = "";
    document.querySelectorAll('[role="option"]').forEach((o) =>
      o.addEventListener("click", () => (clicked = o.textContent || "")),
    );
    await fillPage(describePage(), { [`${D}.eyeColor`]: "Brown" });
    expect(clicked).toBe("Brown");
  }, 20000);
});
