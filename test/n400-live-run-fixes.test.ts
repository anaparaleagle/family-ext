// Three defects a real Fill-all against PA-N400 exposed. All three are invisible
// to a config test, and two of them cost a run 10-60 seconds each.
//
// 1. MIXED PAGE ORDERING. /your-family/children carries a plain count field AND a
//    repeater. fillPage rendered the repeater rows FIRST, and the row form covers
//    the count input, so the run logged:
//        fill: FAIL yourFamily.children.totalNumberOfChildren — element not on page
//    Plain fields have to be filled before any Add is clicked.
//
// 2. WAITING OUT A NEXT THAT DOES NOT EXIST. After a repeater row is entered myUSCIS
//    shows only its commit button; there is no Next until the row is saved. The walk
//    waited the full 12s window on three separate pages before falling back:
//        fillAll: still waiting for Next to enable (10s of 12s) — no button found yet
//        fillAll: no Next — clicking "Save Entry" to commit the row, then advancing
//    The descriptor already carries the exact label, so it should commit first.
//
// 3. RETRYING AN UPLOAD THAT NEVER HAPPENED. With nothing attached, the advance
//    logic still burned all six attempts insisting myUSCIS was "still processing
//    the upload". There was no upload.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fillAll, fillPage, planPageFill } from "../src/runner/fill-chain";
import { t } from "../src/runner/types";
import type { FormConfig, FormPage } from "../src/runner/types";
import { N400_PAGES } from "../src/n400/form-descriptor";
import { radioGroup, setBody, textInput } from "./fixtures/dom";

const BASE = "https://my.uscis.gov/forms/application-for-naturalization/13375119";

/** Put the mock window on a page, so detectCurrentPage can recognise it.
 *
 * happy-dom exposes its own control surface on window.happyDOM, which is not in
 * the DOM lib types — hence the narrow cast rather than a global declaration. */
function goTo(slug: string): void {
  const w = window as unknown as { happyDOM?: { setURL?: (u: string) => void } };
  w.happyDOM?.setURL?.(BASE + slug);
}

const CH = "yourFamily.children.childrenInformation";

const childrenPage = (): FormPage => ({
  slug: "/your-family/children",
  title: "Children",
  kind: "form",
  fields: [
    t("yourFamily.children.totalNumberOfChildren"),
    t(`${CH}.{i}.childInfo.name.firstName`),
    t(`${CH}.{i}.childInfo.dateOfBirth`),
  ],
  repeater: {
    namePrefix: CH,
    addButtonText: "add a child",
    rowCommitButtonText: "Save child",
  },
});

describe("planPageFill — a mixed page fills its plain fields first", () => {
  it("marks plain fields apart from repeater row fields", () => {
    const plan = planPageFill(childrenPage(), {
      "yourFamily.children.totalNumberOfChildren": "1",
      [`${CH}.0.childInfo.name.firstName`]: "Anaya",
      [`${CH}.0.childInfo.dateOfBirth`]: "08/09/2016",
    });
    const plain = plan.filter((p) => p.plain);
    const rows = plan.filter((p) => !p.plain);
    expect(plain.map((p) => p.spec.name)).toEqual(["yourFamily.children.totalNumberOfChildren"]);
    expect(rows).toHaveLength(2);
  });

  it("orders every plain field before any row field", () => {
    // Not cosmetic: clicking Add covers the plain inputs, so anything plain that
    // is planned after a row field can no longer be reached.
    const plan = planPageFill(childrenPage(), {
      "yourFamily.children.totalNumberOfChildren": "1",
      [`${CH}.0.childInfo.name.firstName`]: "Anaya",
    });
    const lastPlain = plan.reduce((acc, p, i) => (p.plain ? i : acc), -1);
    const firstRow = plan.findIndex((p) => !p.plain);
    expect(lastPlain).toBeLessThan(firstRow);
  });
});

describe("fillPage — DOM order on a mixed page", () => {
  beforeEach(() => {
    // The count input exists up front; the row inputs only appear after Add, which
    // is exactly the shape that broke. The Add handler REMOVES the count field, the
    // way myUSCIS's row form covers it.
    setBody(`
      <div>
        <input type="text" name="yourFamily.children.totalNumberOfChildren" id="count" />
        <button id="add">Add a child</button>
      </div>
    `);
    document.getElementById("add")!.addEventListener("click", () => {
      document.getElementById("count")!.remove();
      const row = document.createElement("div");
      row.innerHTML =
        `<input type="text" name="${CH}.0.childInfo.name.firstName" id="fn" />` +
        `<input type="text" name="${CH}.0.childInfo.dateOfBirth" id="dob" />`;
      document.body.appendChild(row);
    });
  });

  it("fills the count BEFORE clicking Add, so it is not lost", async () => {
    const { fillPage } = await import("../src/runner/fill-chain");
    const res = await fillPage(childrenPage(), {
      "yourFamily.children.totalNumberOfChildren": "1",
      [`${CH}.0.childInfo.name.firstName`]: "Anaya",
      [`${CH}.0.childInfo.dateOfBirth`]: "08/09/2016",
    });
    // All three attempted, none reported "element not on page".
    expect(res.failed, JSON.stringify(res.results.filter((r) => !r.success))).toBe(0);
    expect(res.filled).toBe(3);
  });
});

// WHOLE PAGES LEFT BLANK. A firm's Fill-all typed nothing on several sections
// whose values the backend did send: myUSCIS had nested each page under itself as
// a `-page-1` child, the bare slug stopped matching by suffix, and the walk logged
// "page not in descriptor" and clicked past. Runs the REAL descriptor, because the
// firm was looking at the whole walk, not the matcher.
// Kept ahead of the not-awaited walk below, so no other run is in flight.
describe("fillAll — a page myUSCIS nested under itself still gets filled", () => {
  const GMC = "moralCharacter.goodMoralCharacter";
  const QUESTIONS = [
    `${GMC}.involvedInTorture.question`,
    `${GMC}.involvedInGenocide.question`,
    `${GMC}.involvedInKilling.question`,
    `${GMC}.involvedInIntentionallyHarming.question`,
  ];

  it("types on the page-1 route instead of skipping it as unknown", async () => {
    goTo("/moral-character/good-moral-character/good-moral-character-page-1");
    setBody(
      QUESTIONS.map((n) =>
        radioGroup(n, [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]),
      ).join("") + `<button data-testid="next-button">Next</button>`,
    );
    const config: FormConfig = {
      formType: "N-400",
      hostPath: "/forms/application-for-naturalization/",
      label: "N-400",
      pages: N400_PAGES,
    };
    const values = Object.fromEntries(QUESTIONS.map((n) => [n, "false"]));

    const summaries = await fillAll(config, values, async () => 0);

    expect(
      summaries.map((s) => s.slug),
      "the page-1 route was not recognised — nothing was typed",
    ).toEqual(["/moral-character/good-moral-character"]);
    expect(summaries[0].filled).toBe(4);
    for (const n of QUESTIONS) {
      const no = document.querySelector<HTMLInputElement>(`input[name="${n}"][value="false"]`);
      expect(no?.checked, n).toBe(true);
    }
  }, 40000);

  it("still stops dead on the review section, page-1 route included", async () => {
    // onTerminalPath is checked before detection, so the alias must not give the
    // walk a reason to click through the statement and signature pages.
    goTo("/review-and-submit/review-your-application/review-your-application-page-1");
    setBody(`<button data-testid="next-button">Next</button>`);
    let clicked = false;
    document.querySelector("button")!.addEventListener("click", () => (clicked = true));
    const config: FormConfig = {
      formType: "N-400",
      hostPath: "/forms/application-for-naturalization/",
      label: "N-400",
      pages: N400_PAGES,
    };

    const summaries = await fillAll(config, {}, async () => 0);

    expect(summaries).toEqual([]);
    expect(clicked, "the walk clicked Next on the review section").toBe(false);
  });
});

describe("fillAll — commits a repeater row instead of waiting out a missing Next", () => {
  it("clicks the descriptor's commit label, which is what makes Next appear", () => {
    // The live shape: a repeater page shows ONLY its commit button. There is no
    // Next until the row is saved, so waiting for one first is dead time — it cost
    // 12s on each of three pages. Committing is what produces the Next.
    goTo("/your-family/children");
    setBody(`<button id="save">Save child</button>`);
    let nextAppeared = false;
    document.getElementById("save")!.addEventListener("click", () => {
      nextAppeared = true;
      const b = document.createElement("button");
      b.setAttribute("data-testid", "next-button");
      b.textContent = "Next";
      document.body.appendChild(b);
    });

    const config: FormConfig = {
      formType: "N-400",
      hostPath: "/forms/application-for-naturalization/",
      label: "N-400",
      pages: [childrenPage()],
    };
    // Not awaited: happy-dom never navigates, so the walk would sit on its Next
    // wait. What is under test is the ORDER — commit before that wait begins.
    void fillAll(config, {}, async () => 0);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(nextAppeared, "commit button was never clicked").toBe(true);
        resolve();
      }, 1500);
    });
  });
});

describe("fillAll — does not retry an upload that never happened", () => {
  it("advances on one click when nothing was attached", async () => {
    // An ENABLED Next, so the walk can actually advance and finish rather than
    // sitting on a wait. With 0 attached it must not take the 60s upload window
    // nor the six "still processing" retries.
    goTo("/evidence/your-permanent-resident-card");
    setBody(`<button data-testid="next-button">Next</button>`);
    const uploadPage: FormPage = {
      slug: "/evidence/your-permanent-resident-card",
      title: "Your Permanent Resident Card",
      kind: "upload",
      fields: [],
    };
    const config: FormConfig = {
      formType: "N-400",
      hostPath: "/forms/application-for-naturalization/",
      label: "N-400",
      pages: [uploadPage],
    };
    const onUpload = vi.fn(async () => 0);

    const started = Date.now();
    await fillAll(config, {}, onUpload);
    const elapsed = Date.now() - started;

    expect(onUpload).toHaveBeenCalledOnce();
    // Six attempts with waits between them ran well over a minute on a page where
    // there was nothing to process.
    expect(elapsed).toBeLessThan(20000);
  }, 30000);
});

// A REPEATER ON A DRAFT THAT ALREADY HAS SAVED ROWS. Live on draft 13375119
// (SOF-1312): /about-you/where-you-have-lived reported 0/7, every field "element
// not on page", and the same shape killed the walk on schools-and-employment at
// page 8 of 57.
//
// The row field NAMES were right. The INDEX was not. The page renders no inputs at
// all — it shows saved rows with Edit/Delete plus "Add another address" — and the
// row that Add opens is numbered AFTER the saved ones. With one address already
// saved the new row is:
//
//   applicant.whereYouHaveLived.1.address.zipCode
//
// The chain asked for row 0 because that is the payload's index, polled three
// seconds for `...0.` and returned silently when it never came. So every repeater
// fails completely on any draft that already holds rows, which is bugs 3, 7 and 8
// of the ticket in one defect.
//
// The index is DISCOVERED rather than assumed, so a blank draft (Add renders 0)
// and a draft with saved rows (Add renders 1) both work without counting anything.
describe("fillPage — a repeater row myUSCIS numbers after the rows already saved", () => {
  const PREFIX = "applicant.whereYouHaveLived";
  const COLS = ["address.country", "address.city", "address.zipCode"];

  const page: FormPage = {
    slug: "/about-you/where-you-have-lived",
    title: "Where you have lived",
    kind: "form",
    fields: COLS.map((c) => t(`${PREFIX}.{i}.${c}`)),
    repeater: {
      namePrefix: PREFIX,
      // The live label, which is NOT the "add an address" the descriptor carried.
      addButtonText: "add another address",
      rowCommitButtonText: "Save entry",
    },
  };

  // The payload is 0-indexed off our own list fact, and stays that way — what
  // moves is which DOM row it is written into.
  const values: Record<string, string> = {
    [`${PREFIX}.0.address.country`]: "United States",
    [`${PREFIX}.0.address.city`]: "Aurora",
    [`${PREFIX}.0.address.zipCode`]: "60505",
  };

  /** A saved-row summary: no inputs, an Add control, and Add renders row `index`. */
  function summaryWithAddRenderingRow(index: number): void {
    setBody(`<button type="button">Add another address</button>`);
    document.querySelector("button")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        COLS.map((c) => textInput(`${PREFIX}.${index}.${c}`)).join(""),
      );
    });
  }

  it("fills the row that actually rendered, not the index the payload used", async () => {
    summaryWithAddRenderingRow(1);
    const res = await fillPage(page, values);
    expect(res.failed, "asked for a row index myUSCIS did not render").toBe(0);
    expect(res.filled).toBe(3);
    const zip = document.querySelector<HTMLInputElement>(`[name="${PREFIX}.1.address.zipCode"]`);
    expect(zip?.value).toBe("60505");
  }, 30000);

  it("still fills row 0 on a blank draft", async () => {
    // Non-vacuity: the blank case already worked and must keep working, or the fix
    // has just moved the bug to the other kind of draft.
    summaryWithAddRenderingRow(0);
    const res = await fillPage(page, values);
    expect(res.failed).toBe(0);
    expect(res.filled).toBe(3);
    const zip = document.querySelector<HTMLInputElement>(`[name="${PREFIX}.0.address.zipCode"]`);
    expect(zip?.value).toBe("60505");
  }, 30000);
});

// The Oath of allegiance has a SECOND page, captured live off draft 13375119. The
// descriptor had no entry for it, so the walk logged "page not in descriptor" and
// clicked past three questions the client had already answered — the rest of the
// ticket's "Oath of allegiance not filled at all", beyond the -page-1 routing.
describe("N-400 descriptor — oath of allegiance page 2", () => {
  const SLUG = "/moral-character/oath-of-allegiance/oath-of-allegiance-page-2";

  it("declares the page", () => {
    expect(N400_PAGES.map((p) => p.slug)).toContain(SLUG);
  });

  it("drives all three willingness radios", () => {
    const page = N400_PAGES.find((p) => p.slug === SLUG);
    const names = (page?.fields ?? []).map((f) => f.name);
    for (const n of [
      "moralCharacter.oathOfAllegiancePage2.willingToBearArms",
      "moralCharacter.oathOfAllegiancePage2.willingToPerformNonCombat",
      "moralCharacter.oathOfAllegiancePage2.willingToWorkUnderCivilian",
    ]) {
      expect(names, n).toContain(n);
    }
    for (const f of page?.fields ?? []) expect(f.kind).toBe("radio");
  });

  it("is a page-2 slug the -page-1 alias could never have reached", () => {
    // Spelled out because the alias fixed eight of the nine nested routes and it is
    // easy to assume it covers this one too. It cannot: the alias derives
    // `<slug>/<last>-page-1`, and nothing derives a -page-2.
    const bare = "/moral-character/oath-of-allegiance";
    expect(SLUG).not.toBe(`${bare}/oath-of-allegiance-page-1`);
    expect(N400_PAGES.map((p) => p.slug)).toContain(bare);
  });
});

// A FIELD THE FORM HAS MADE READ-ONLY. Live on the N-400 contact page: ticking
// "This is the same as my current physical address" makes myUSCIS mirror the
// physical address into the mailing block ITSELF and mark all seven mailing inputs
// readOnly. Probed on draft 13375119 they held exactly the right values already —
// United States / Illinois / Naperville / 60564 / 123 Naperville Road — and they
// were the only read-only inputs on the page.
//
// We got that wrong in both directions. The two autocompletes reported "no match",
// because a read-only box will not open a listbox. The other five reported SUCCESS:
// setText's native-setter strategy assigns straight through readOnly, so we were
// writing into fields the form had declared its own and counting it as filled. It
// only looked harmless because the mirrored values happened to equal ours.
//
// A read-only input is not ours to set. Skip it, and do not touch it.
describe("fillPage — a field the form has made read-only", () => {
  it("skips it rather than failing, and leaves its value alone", async () => {
    setBody(
      textInput("applicant.mailing.city") +
        `<input type="text" name="applicant.mailing.state" id="applicant.mailing.state" value="Illinois" readonly />`,
    );
    const page: FormPage = {
      slug: "/contact",
      title: "Contact",
      kind: "form",
      fields: [t("applicant.mailing.city"), t("applicant.mailing.state")],
    };

    const res = await fillPage(page, {
      "applicant.mailing.city": "Naperville",
      // Deliberately DIFFERENT from what the mirror holds, so a stray write shows up.
      "applicant.mailing.state": "Ohio",
    });

    expect(res.failed, "a read-only field must not count as a failure").toBe(0);
    expect(res.filled).toBe(1);
    expect(res.skipped, "the read-only field should be skipped, not filled").toBe(1);
    const state = document.querySelector<HTMLInputElement>('[name="applicant.mailing.state"]');
    expect(state?.value, "wrote into a field the form marked read-only").toBe("Illinois");
    const city = document.querySelector<HTMLInputElement>('[name="applicant.mailing.city"]');
    expect(city?.value, "a writable field beside it must still fill").toBe("Naperville");
  }, 20000);
});
