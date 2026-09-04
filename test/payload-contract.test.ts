// The stored payload has to say WHOSE answers it holds.
//
// src/runner/payload.ts is the one data contract between the popup (which loads)
// and the content script (which types), and it has never had a test. On a
// one-applicant case it did not need one: a case had exactly one person, so
// "which case" and "which person" were the same question.
//
// A couple naturalising together makes them different questions. The N-400 on
// screen belongs to ONE of the two applicants, and the loaded payload is the
// only thing that knows which. If it cannot say, the failure is silent and it
// reaches a sworn form: the second applicant's N-400 filled with the first
// applicant's answers, under the second applicant's name.
//
// Read through a widened view on purpose. Asserting `STORAGE_KEYS.memberIndex`
// directly would fail TYPECHECK, which runs before the tests and would stop them
// ever running - a compile error, not the missing behaviour.

import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../src/runner/payload";

const keys: Record<string, string> = STORAGE_KEYS;

describe("the loaded payload records which member it is for", () => {
  it("has a storage key for the member index", () => {
    expect(keys.memberIndex).toBeTruthy();
  });

  it("keeps the member key distinct from the case key", () => {
    expect(keys.memberIndex).not.toBe(keys.caseId);
  });

  it("namespaces the member key like every other myUSCIS key", () => {
    expect(keys.memberIndex ?? "").toMatch(/^myuscis/);
  });
});
