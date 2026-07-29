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
