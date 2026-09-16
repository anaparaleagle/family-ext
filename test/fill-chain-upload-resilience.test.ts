// The walk must SURVIVE a failing upload page.
//
// This is the second half of the doc-upload bug (2026-07-27). `fillAll` awaited
// `onUploadPage` with no guard, and `onFillAll` fires it as `void onFillAll()` —
// so when the upload step rejected (a CORS-refused documents fetch), the whole
// run ended as an unhandled rejection and the debug log simply STOPPED after the
// last filled page. No stop-reason line, nothing to diagnose from.
//
// The contract locked here: a rejecting upload step is logged and the walk keeps
// going. It must never take the run down with it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fillAll } from "../src/runner/fill-chain";
import { debugLog, resetDebugLog } from "../src/engine/logger";
import type { FormConfig } from "../src/runner/types";

const HOST_PATH = "/forms/application-to-extend-change-nonimmigrant-status";
const BASE = `https://my.uscis.gov${HOST_PATH}/13212561`;

/**
 * Navigate the test DOM.
 *
 * `history.pushState` does NOT move window.location under happy-dom (it is a
 * no-op there, relative or absolute), so a fixture built on it leaves location
 * at "/" and the walk correctly reports "page did not change after Next" —
 * a broken fixture that reads exactly like a broken chain. Assigning href is
 * what a real Next click does anyway.
 */
function goTo(url: string): void {
  (window.location as unknown as { href: string }).href = url;
}

const CONFIG: FormConfig = {
  formType: "I-539",
  label: "Test I-539",
  hostPath: HOST_PATH,
  pages: [
    {
      slug: "/evidence/form-i-94",
      title: "Form I-94",
      kind: "upload",
      fields: [],
    },
    {
      slug: "/review-and-submit/review-your-application",
      title: "Review your application",
      kind: "review",
      fields: [],
    },
  ],
};

/**
 * Put the document on the upload page with an enabled Next that navigates to the
 * review page — so the walk advances immediately instead of burning the 60s
 * upload-page Next timeout.
 */
function mountUploadPageWithWorkingNext(): void {
  goTo(`${BASE}/evidence/form-i-94`);
  document.body.innerHTML = `
    <h1>Form I-94</h1>
    <button data-testid="next-button">Next</button>
  `;
  const next = document.querySelector("button")!;
  next.addEventListener("click", () => {
    goTo(`${BASE}/review-and-submit/review-your-application`);
  });
}

beforeEach(() => {
  resetDebugLog();
  // dbg() mirrors into chrome.storage.local; give it a no-op so logging works.
  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    runtime: { sendMessage: vi.fn(async () => ({ success: false, error: "not used" })) },
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("fillAll: a failing upload page never kills the walk", () => {
  it("resolves (does not reject) when the upload step throws", async () => {
    mountUploadPageWithWorkingNext();
    const onUploadPage = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });

    // The assertion that matters: this settles, and settles as fulfilled.
    await expect(fillAll(CONFIG, {}, onUploadPage)).resolves.toBeDefined();
    expect(onUploadPage).toHaveBeenCalledTimes(1);
  }, 20000);

  it("logs a stop reason instead of going silent", async () => {
    mountUploadPageWithWorkingNext();
    await fillAll(CONFIG, {}, async () => {
      throw new Error("Failed to fetch");
    });

    const log = debugLog.join("\n");
    // The upload failure is named...
    expect(log).toMatch(/form-i-94/);
    // ...and the run ends with an explicit reason, never in silence.
    expect(log).toMatch(/review|stopping/i);
  }, 20000);

  it("still advances past the bad upload page to the next page", async () => {
    mountUploadPageWithWorkingNext();
    await fillAll(CONFIG, {}, async () => {
      throw new Error("Failed to fetch");
    });
    // It clicked Next and reached the review page rather than dying on upload.
    expect(window.location.pathname).toContain("/review-and-submit/review-your-application");
  }, 20000);
});

// ── The walk must not mistake an undeclared page for having left the form ────
//
// Live I-129 run 2026-09-09 (draft 13775600): 104/106 fields filled, and
// "upload pages visited: none". Four evidence pages we deliberately do not
// handle sit back to back after the last typed page, and the old guard read
// four unrecognised pages in a row as "we have left the form" and stopped — so
// the passport and I-94 pages BEHIND them were never reached and nothing
// attached. Leaving the form is a property of the URL, which the hostPath check
// at the foot of the loop already tests; a page inside the form that we simply
// have not declared is not the same thing.

const EVIDENCE_CONFIG: FormConfig = {
  formType: "I-539",
  label: "Test I-539",
  hostPath: HOST_PATH,
  pages: [
    { slug: "/evidence/form-i-94", title: "Form I-94", kind: "upload", fields: [] },
    {
      slug: "/review-and-submit/review-your-application",
      title: "Review your application",
      kind: "review",
      fields: [],
    },
  ],
};

/**
 * Walk a fixed list of URLs: each page carries a Next that navigates to the one
 * after it and re-renders, which is what a real Next click does.
 */
function driveChain(urls: string[]): void {
  let i = 0;
  const mount = (): void => {
    goTo(urls[i]);
    document.body.innerHTML = `
      <h1>Step ${i + 1}</h1>
      <button data-testid="next-button">Next</button>
    `;
    document.querySelector("button")!.addEventListener("click", () => {
      if (i < urls.length - 1) {
        i += 1;
        mount();
      }
    });
  };
  mount();
}

const FIVE_UNDECLARED = [
  `${BASE}/evidence/certified-labor-condition-application`,
  `${BASE}/evidence/evidence-of-specialty-occupation`,
  `${BASE}/evidence/degree-or-evidence-of-special-training`,
  `${BASE}/evidence/license-and-certificates`,
  `${BASE}/evidence/one-more-page-we-never-captured`,
];

describe("fillAll: undeclared pages inside the form do not end the walk", () => {
  it("reaches the declared upload page sitting behind five undeclared ones", async () => {
    driveChain([
      ...FIVE_UNDECLARED,
      `${BASE}/evidence/form-i-94`,
      `${BASE}/review-and-submit/review-your-application`,
    ]);
    const onUploadPage = vi.fn(async () => 1);

    await fillAll(EVIDENCE_CONFIG, {}, onUploadPage);

    expect(onUploadPage).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toContain("/review-and-submit/review-your-application");
  }, 20000);

  it("names the undeclared pages it walked past in the run summary", async () => {
    driveChain([
      ...FIVE_UNDECLARED,
      `${BASE}/evidence/form-i-94`,
      `${BASE}/review-and-submit/review-your-application`,
    ]);

    await fillAll(EVIDENCE_CONFIG, {}, async () => 1);

    const log = debugLog.join("\n");
    expect(log).toMatch(/walked past 5 page\(s\) the descriptor does not declare/);
    expect(log).toMatch(/license-and-certificates/);
  }, 20000);

  it("still stops when the URL actually leaves the form", async () => {
    driveChain([
      `${BASE}/evidence/certified-labor-condition-application`,
      "https://my.uscis.gov/account/change-of-address",
      `${BASE}/evidence/form-i-94`,
    ]);
    const onUploadPage = vi.fn(async () => 1);

    await fillAll(EVIDENCE_CONFIG, {}, onUploadPage);

    expect(debugLog.join("\n")).toMatch(/navigation left the .* form/);
    expect(onUploadPage).not.toHaveBeenCalled();
    expect(window.location.pathname).toContain("/account/change-of-address");
  }, 20000);
});

// ── An EMPTY pdf-intake evidence page needs a SECOND Next click ──────────────
//
// Live I-485 capture 2026-09-15: the first Next click on an evidence page with
// nothing uploaded does not navigate — it injects a "Missing Evidence" warning
// and waits. The second click advances. The advance logic used to spend exactly
// one click whenever nothing was attached (correctly, for the I-765, where an
// empty page simply had nothing to wait for), so the walk stalled at the first
// empty slot. The I-485 has 14 evidence slots and several are "if applicable",
// so an empty one is the normal case, not the exception.

const PDF_INTAKE_HOST = "/pdf-intake/I-485";
const PDF_INTAKE_BASE = `https://my.uscis.gov${PDF_INTAKE_HOST}/5ab9035c`;

const PDF_INTAKE_CONFIG: FormConfig = {
  formType: "I-485",
  label: "Test I-485",
  hostPath: PDF_INTAKE_HOST,
  pages: [
    {
      slug: "/i-508-form-upload/I-485/evidence",
      title: "I-508 waiver",
      kind: "upload",
      fields: [],
    },
    { slug: "/review", title: "Review your submission", kind: "review", fields: [] },
  ],
};

/** The live behaviour: click 1 warns in-page, click 2 navigates. */
function mountEmptyEvidencePage(): () => number {
  goTo(`${PDF_INTAKE_BASE}/i-508-form-upload/I-485/evidence`);
  document.body.innerHTML = `
    <h1>I-508 waiver</h1>
    <button data-testid="next-btn">Next</button>
  `;
  let clicks = 0;
  document.querySelector("button")!.addEventListener("click", () => {
    clicks += 1;
    if (clicks === 1) {
      document.body.insertAdjacentHTML(
        "afterbegin",
        "<div>It does not appear that you have uploaded any evidence</div>",
      );
      return;
    }
    goTo(`${PDF_INTAKE_BASE}/review`);
  });
  return () => clicks;
}

describe("fillAll: an empty pdf-intake evidence page", () => {
  it("clicks past the missing-evidence warning instead of stalling", async () => {
    const clicks = mountEmptyEvidencePage();

    await fillAll(PDF_INTAKE_CONFIG, {}, async () => 0);

    expect(clicks(), "one click is not enough on an empty evidence page").toBe(2);
    expect(window.location.pathname).toContain("/review");
  }, 20000);

  it("says in the log why it clicked again", async () => {
    mountEmptyEvidencePage();
    await fillAll(PDF_INTAKE_CONFIG, {}, async () => 0);
    expect(debugLog.join("\n")).toMatch(/missing-evidence warning/i);
  }, 20000);

  it("never reports the empty page as an upload still processing", async () => {
    // The old message told the caseworker myUSCIS was busy with a file that was
    // never sent. Whatever happens on an empty page, it is not that.
    mountEmptyEvidencePage();
    await fillAll(PDF_INTAKE_CONFIG, {}, async () => 0);
    expect(debugLog.join("\n")).not.toMatch(/still processing the upload/);
  }, 20000);
});
