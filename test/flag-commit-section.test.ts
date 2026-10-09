// Committing a FLAG section — pressing the portal's own Continue.
//
// nav.ts has said from the start that "a sidebar click is not a commit: FLAG
// persists a section when you press Continue, not when you navigate away from
// it". The helper that finds the button was written and then never called, so
// `fillAll` typed ten sections and saved none of them: every section the walk
// left behind was discarded, and the toolbar reported the typing as success.
//
// The old portal extension did press it (content.ts clickContinueButton, with a
// "Page didn't change after Continue click" stop). These tests pin that back.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { commitSection, findCommitButton } from "../src/flag/nav";

function page(html: string): void {
  document.body.innerHTML = html;
}

/** FLAG accepting the section: the next one renders, so the fingerprint moves. */
function advanceOnClick(selector: string, nextHtml: string): void {
  document.querySelector<HTMLElement>(selector)!.addEventListener("click", () => {
    document.body.innerHTML = nextHtml;
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("finding the Continue button", () => {
  it("finds Continue, Save & Continue and Next", () => {
    for (const label of ["Continue", "Save & Continue", "Next"]) {
      page(`<button>${label}</button>`);
      expect(findCommitButton(), label).not.toBeNull();
    }
  });

  it("never returns Submit, Sign, Certify, Delete, Withdraw or Pay", () => {
    // The one guard between a fill and an application filed at DOL, which has
    // no undo. A label that merely CONTAINS a banned word is still refused.
    for (const label of ["Submit", "Sign", "Certify", "Delete", "Withdraw", "Pay",
                         "Submit Application", "Sign and Continue"]) {
      page(`<button>${label}</button>`);
      expect(findCommitButton(), label).toBeNull();
    }
  });

  it("ignores a section with no button at all", () => {
    page("<p>nothing here</p>");
    expect(findCommitButton()).toBeNull();
  });
});

describe("committing", () => {
  it("reports committed once FLAG moves to the next section", async () => {
    page('<h1>Section E</h1><input name="e15_agent_firm_name"><button>Continue</button>');
    advanceOnClick("button", '<h1>Section F</h1><input name="_section_f_f1_number_workers">');

    await expect(commitSection()).resolves.toBe("committed");
  });

  it("reports blocked when the page does not change", async () => {
    // FLAG's way of refusing a section: it re-renders the same one with "This
    // field is required." against the boxes it wants. Nothing moves.
    page('<h1>Section F</h1><input name="_section_f_f1_number_workers"><button>Continue</button>');

    await expect(commitSection()).resolves.toBe("blocked");
  }, 15000);

  it("reports no-button rather than throwing", async () => {
    page('<h1>Section K</h1><input name="k1_prep_last">');

    await expect(commitSection()).resolves.toBe("no-button");
  });

  it("does not click a Submit button when that is all there is", async () => {
    page('<h1>Section K</h1><button id="go">Submit</button>');
    const onClick = vi.fn();
    document.getElementById("go")!.addEventListener("click", onClick);

    await expect(commitSection()).resolves.toBe("no-button");
    expect(onClick).not.toHaveBeenCalled();
  });
});
