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
import { fillAll, planPageFill } from "../src/runner/fill-chain";
import { t } from "../src/runner/types";
import type { FormConfig, FormPage } from "../src/runner/types";
import { N400_PAGES } from "../src/n400/form-descriptor";
import { radioGroup, setBody } from "./fixtures/dom";

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
