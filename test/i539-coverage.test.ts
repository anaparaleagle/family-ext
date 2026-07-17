// Cross-check the I-539 structural descriptor against the LIVE FIELD DUMP
// (paraleagle-dev/i539-online-field-dump/). This is the I-539 analogue of
// coverage.test.ts — except there is no backend value map for the I-539 yet, so
// the dump is the only source of truth available, and this test guards that seam:
//
//   every fillable field myUSCIS actually renders is either
//     (a) in I539_PAGES  — we drive it, or
//     (b) in I539_SKIP   — we deliberately leave it to the user, on the record.
//
// Nothing may fall between the two. If USCIS adds a field and someone re-captures
// the dump, this test fails until a human classifies it — which is the point.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { I539_PAGES, I539_SKIP } from "../src/i539/form-descriptor";
import { fieldNamesOf } from "../src/runner/types";

const DUMP_DIR = resolve(__dirname, "../../i539-online-field-dump");
/** The full happy-path capture: 24 primary screens (00..23) of an F-1 change-of-status. */
const PRIMARY_BRANCH = "f1-cos";
/** The reason/status delta captures — same pages, different status/reason answers. */
const DELTA_BRANCHES = ["f1-eos", "b1b2", "j1", "h4", "l2"];

interface DumpField {
  name: string | null;
  tag: string;
  type: string;
}

/** Every distinct fillable field name captured in a dump branch. */
function dumpFieldNames(branch: string): string[] {
  const dir = resolve(DUMP_DIR, branch);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const screen = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
    for (const field of (screen.fields ?? []) as DumpField[]) {
      // Upload dropzones are <input type="file"> with NO name — nothing to type.
      if (!field.name || field.type === "file") continue;
      names.add(field.name);
    }
  }
  return [...names];
}

describe("I-539 descriptor <-> live field dump", () => {
  const driven = new Set(fieldNamesOf(I539_PAGES));
  const skipped = new Set(I539_SKIP);

  it("accounts for every fillable field in the f1-cos capture (driven or skipped)", () => {
    const unaccounted = dumpFieldNames(PRIMARY_BRANCH).filter(
      (n) => !driven.has(n) && !skipped.has(n),
    );
    expect(
      unaccounted,
      `dump fields neither driven nor skipped: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("accounts for every fillable field in the status/reason delta captures", () => {
    // The sidebar is stable across statuses — these branches must not introduce
    // a field the F-1 capture never showed. If one appears, the "one linear
    // descriptor" assumption is wrong and we need to know immediately.
    for (const branch of DELTA_BRANCHES) {
      const unaccounted = dumpFieldNames(branch).filter((n) => !driven.has(n) && !skipped.has(n));
      expect(unaccounted, `${branch}: unaccounted fields: ${unaccounted.join(", ")}`).toEqual([]);
    }
  });

  it("never both drives and skips the same field", () => {
    const both = [...skipped].filter((n) => driven.has(n));
    expect(both, `fields both driven and skipped: ${both.join(", ")}`).toEqual([]);
  });

  it("skips nothing that myUSCIS does not actually render", () => {
    // A stale skip entry is dead weight that hides drift — every skipped name
    // must exist somewhere in the capture.
    const captured = new Set([
      ...dumpFieldNames(PRIMARY_BRANCH),
      ...DELTA_BRANCHES.flatMap((b) => dumpFieldNames(b)),
    ]);
    const phantom = I539_SKIP.filter((n) => !captured.has(n));
    expect(phantom, `skip entries not present in any capture: ${phantom.join(", ")}`).toEqual([]);
  });

  it("drives the six gating '.none' toggles instead of skipping them (SOF-755)", () => {
    // These GATE a required field's Next button when its backing fact is blank
    // (no A-Number / SSN / USCIS# / passport / travel-doc / email). The backend
    // map checks each when blank, so they must be DRIVEN, not left in I539_SKIP —
    // otherwise a Fill-all stalls on the page until a human ticks the box.
    const gating = [
      "formikFactoryUIMeta.applicant.otherInformation.alienNumber.none",
      "formikFactoryUIMeta.applicant.otherInformation.socialSecurityNumber.none",
      "formikFactoryUIMeta.applicant.otherInformation.uscisNumber.none",
      "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.passport.none",
      "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.noTravelDocumentNumber",
      "formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.noEmail",
    ];
    for (const name of gating) {
      expect(driven.has(name), `${name} must be driven`).toBe(true);
      expect(skipped.has(name), `${name} must NOT be in I539_SKIP`).toBe(false);
    }
  });

  it("drives every non-UI-meta applicant field the capture shows", () => {
    // The skip list is meant to hold ONLY UI-meta toggles + preparer/interpreter
    // identity. Anything else being skipped would be a silent coverage hole.
    const wrongfullySkipped = I539_SKIP.filter(
      (n) =>
        !n.startsWith("formikFactoryUIMeta.") &&
        !n.startsWith("gettingStarted.preparer.") &&
        !n.startsWith("gettingStarted.interpreter."),
    );
    expect(
      wrongfullySkipped,
      `skip list should only hold UI-meta + preparer/interpreter: ${wrongfullySkipped.join(", ")}`,
    ).toEqual([]);
  });
});

describe("I-539 descriptor shape", () => {
  it("marks the three evidence pages as upload-only", () => {
    const uploads = I539_PAGES.filter((p) => p.kind === "upload");
    expect(uploads.map((p) => p.slug)).toEqual([
      "/evidence/form-i-94",
      "/evidence/written-statement",
      "/evidence/additional-evidence",
    ]);
    for (const p of uploads) expect(p.fields.length).toBe(0);
  });

  it("declares the additional-information repeater with its real Add label", () => {
    const page = I539_PAGES.find((p) => p.repeater);
    expect(page?.slug).toBe("/additional-information/additional-information");
    // "Add a response" — captured from the live page (22b). The I-130's generic
    // "add" would also match here, but the specific phrase is what the dump says.
    expect(page?.repeater?.addButtonText).toBe("add a response");
    expect(page?.repeater?.namePrefix).toBe("additionalInformationArray");
    expect(page?.fields.every((f) => f.name.includes("{i}"))).toBe(true);
  });

  it("terminates on the captured review page, which is last and fills nothing", () => {
    // Was "has NO review page (documented gap)" until the live capture on
    // 2026-07-15 (dump f1-cos/23-review-and-submit.json). The slug below is the
    // real one, read off the sidebar link's href on draft 13218429 — not guessed.
    const reviews = I539_PAGES.filter((p) => p.kind === "review");
    expect(reviews.map((p) => p.slug)).toEqual(["/review-and-submit/review-your-application"]);
    // The page renders no inputs at all, so there is nothing to type here.
    expect(reviews[0].fields).toEqual([]);
    // It must be LAST: fillAll breaks on kind === "review", so any page after it
    // would be silently unreachable.
    expect(I539_PAGES[I539_PAGES.length - 1].kind).toBe("review");
  });

  it("matches the review slug the live dump captured", () => {
    // Locks descriptor <-> dump agreement for the one page whose slug is
    // safety-critical: get it wrong and the walk clicks Next into Submit/Pay.
    const dump = JSON.parse(
      readFileSync(resolve(DUMP_DIR, PRIMARY_BRANCH, "23-review-and-submit.json"), "utf-8"),
    );
    const review = I539_PAGES.find((p) => p.kind === "review")!;
    expect(new URL(dump.url).pathname.endsWith(review.slug)).toBe(true);
    expect(dump.fields).toEqual([]);
  });

  it("uses no beneficiary.* names — the I-539 has a single applicant party", () => {
    // The I-130's applicant/beneficiary inversion must not leak into this form.
    const names = fieldNamesOf(I539_PAGES);
    expect(names.filter((n) => n.startsWith("beneficiary."))).toEqual([]);
    expect(names.filter((n) => n.startsWith("petitioner."))).toEqual([]);
  });

  it("drives the status + change-of-status pickers as autocompletes, not text", () => {
    // These filter by USCIS DISPLAY TEXT, not the code — driving them as plain
    // text types a value the listbox never commits.
    const all = I539_PAGES.flatMap((p) => p.fields);
    const status = all.find((f) => f.name.endsWith("basisOfEligibility.currentNonImmigrantStatus"));
    const target = all.find((f) => f.name.endsWith("statusInfo.changeOfStatus"));
    expect(status?.kind).toBe("search");
    expect(target?.kind).toBe("search");
  });

  it("has unique slugs", () => {
    const slugs = I539_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
