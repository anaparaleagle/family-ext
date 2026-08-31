// ===========================================================================
// I-129 COVERAGE GUARD.
//
// The seam this watches: an online field needs a DESCRIPTOR entry (how to fill
// it) AND a BACKEND MAP entry (what to put in it), and neither half works
// alone. form_myuscis_definitions.json fails SILENTLY by design — a value it
// cannot find resolves to "" — so a name that is in one half and not the other
// is a blank box on a signed federal petition with no error and no red test.
// This file is the only thing that makes that loud.
//
// Three layers:
//
//   1. CAPTURE LOCKS (always run). The vendored capture is a PORT of
//      paraleagle-ext's field map, and it carries facts that read like typos and
//      invite tidying — gender 3=Male/1=Female, a slug with a capital B, the
//      five radio groups whose option strings are label text rather than proven
//      values. These assert the exact values, so a re-capture that moves them
//      stops a human instead of sliding through.
//
//   2. DESCRIPTOR <-> CAPTURE. Every captured field name is driven by the
//      descriptor or listed as deliberately not driven. Nothing in between.
//
//   3. DESCRIPTOR <-> BACKEND MAP (self-skips when the backend repo is not
//      checked out beside this one — same rule as coverage.test.ts).
// ===========================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  I129_PAGES,
  I129_UNCAPTURED,
  I129_UNVERIFIED_OPTIONS,
  descriptorFieldNames,
} from "../src/i129/form-descriptor";
import { I129_CONFIG, configForPath, formTypeForCaseType } from "../src/runner/registry";
import { pageForUrl } from "../src/runner/section-detector";

const CAPTURE = resolve(
  __dirname,
  "fixtures/i129-online-field-dump/i129-field-map-capture.json",
);
const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);

interface CaptureField {
  name: string;
  kind: string;
  label: string;
  options: string[];
  h1b_ids: string[];
  options_verbatim?: boolean;
}
interface CapturePage {
  slug: string;
  section: string;
  formik_prefix: string;
  label: string;
  fields: CaptureField[];
}

const capture = JSON.parse(readFileSync(CAPTURE, "utf-8")) as {
  form_type: string;
  host_path: string;
  pages: CapturePage[];
  skipped_in_h1b_map: string[];
  unrouted: Array<{ h1b_id: string; selector: string }>;
};

const captureFields = (): CaptureField[] => capture.pages.flatMap((p) => p.fields);

// ───────────────────────────────────────────────────────────────────────────
// LAYER 1 — capture locks
// ───────────────────────────────────────────────────────────────────────────

describe("I-129 capture: the vendored port is intact", () => {
  it("holds 29 pages and 157 distinct field names", () => {
    expect(capture.pages.length).toBe(29);
    expect(captureFields().length).toBe(157);
    expect(new Set(captureFields().map((f) => f.name)).size).toBe(157);
  });

  it("names the host path the registry routes on", () => {
    expect(capture.host_path).toBe(I129_CONFIG.hostPath);
  });

  it("has exactly one unrouted field — the OEWS wage-level radio", () => {
    // It is the only I-129 input paraleagle-ext could not name: it reaches it
    // with `[name*="wageLevel" i]`. Our engine resolves a radio by (name, value)
    // and does not apply `locate` to radios, so there is no way to drive it
    // until a live walk reads its real name off the page.
    expect(capture.unrouted.map((u) => u.h1b_id)).toEqual(["DC_wage_level"]);
  });

  it("locks gender as 3=Male / 1=Female", () => {
    // Reads backwards, is right, and is the same pair the I-130 and N-400
    // captures both locked. Re-deriving it files the wrong sex on a petition.
    const gender = captureFields().find(
      (f) => f.name === "beneficiaryInfo.otherInformation.gender",
    );
    expect(gender?.options).toEqual(["3", "1"]);
    expect(gender?.h1b_ids).toEqual(["P3_gender_male", "P3_gender_female"]);
  });

  it("locks the classification codes, which are not the display strings", () => {
    const cls = captureFields().find(
      (f) => f.name === "gettingStarted.reasonForRequest.requestedNonimmigrantClass",
    );
    // "H-1B" on screen is "H1B" in the option, and H-1B1 drops the H entirely.
    expect(cls?.options).toEqual(["H1B", "1B1", "1B2", "1B3"]);
  });

  it("marks exactly the five radio groups whose option text is unverified", () => {
    // paraleagle-ext's filler matches a radio option by SUBSTRING; ours matches
    // exactly. So a multi-word option in the capture is label text that worked as
    // a substring, not a value proven to equal the input's `value`. This list is
    // the work item, and it must not quietly shrink.
    const unverified = captureFields()
      .filter((f) => f.options_verbatim === false)
      .map((f) => f.name)
      .sort();
    expect(unverified).toEqual([...I129_UNVERIFIED_OPTIONS].sort());
  });

  it("keeps a written record of what a live walk still has to capture", () => {
    // An empty list would mean the form is fully captured. It is not.
    expect(I129_UNCAPTURED.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAYER 2 — descriptor <-> capture
// ───────────────────────────────────────────────────────────────────────────

describe("I-129 descriptor <-> vendored capture", () => {
  const driven = new Set(descriptorFieldNames());

  it("drives every captured field name", () => {
    const missing = captureFields()
      .map((f) => f.name)
      .filter((n) => !driven.has(n));
    expect(missing, `capture names the descriptor does not drive: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("invents no field name the capture does not have", () => {
    const known = new Set(captureFields().map((f) => f.name));
    const invented = [...driven].filter((n) => !known.has(n));
    expect(invented, `descriptor names absent from the capture: ${invented.join(", ")}`).toEqual(
      [],
    );
  });

  it("gives every captured field the kind the capture recorded", () => {
    const byName = new Map(captureFields().map((f) => [f.name, f]));
    const wrong: string[] = [];
    for (const page of I129_PAGES) {
      for (const f of page.fields) {
        const captured = byName.get(f.name);
        if (captured && captured.kind !== f.kind) {
          wrong.push(`${f.name}: descriptor ${f.kind} vs capture ${captured.kind}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("puts every field on the page the capture puts it on", () => {
    // The page a field sits on is not cosmetic: the chain fills a page and then
    // clicks Next, so a field filed under the wrong slug is never attempted.
    const capturedPageOf = new Map<string, string>();
    for (const p of capture.pages) for (const f of p.fields) capturedPageOf.set(f.name, p.slug);
    const wrong: string[] = [];
    for (const page of I129_PAGES) {
      for (const f of page.fields) {
        const want = capturedPageOf.get(f.name);
        if (want && want !== page.slug) {
          wrong.push(`${f.name}: descriptor ${page.slug} vs capture ${want}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("declares every captured page as a form page, in capture order", () => {
    const formSlugs = I129_PAGES.filter((p) => p.kind === "form").map((p) => p.slug);
    expect(formSlugs).toEqual(capture.pages.map((p) => p.slug));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAYER 2b — the registry actually reaches this descriptor
// ───────────────────────────────────────────────────────────────────────────

describe("I-129 routing", () => {
  it("routes a live I-129 sub-page URL to the I-129 config", () => {
    const c = configForPath(
      "/forms/petition-for-a-nonimmigrant-worker/12963010/about-beneficiary/beneficiarys-other-information",
    );
    expect(c?.formType).toBe("I-129");
    expect(c?.pages).toBe(I129_PAGES);
  });

  it("picks the I-129 for all six H-1B change-of-status case types", () => {
    for (const code of [
      "H-1B-COS-F1",
      "H-1B-COS-F2",
      "H-1B-COS-J2",
      "H-1B-COS-H4",
      "H-1B-COS-L2",
      "H-1B-COS-L1",
    ]) {
      expect(formTypeForCaseType(code)).toBe("I-129");
    }
  });

  it("resolves each nested sub-page to itself, not to its parent", () => {
    // Five of the 29 slugs are extensions of another ("…/beneficiary-information"
    // and "…/beneficiary-information/beneficiary-information-2"). pageForUrl sorts
    // longest-first for exactly this; assert it rather than trust it.
    const base = "https://my.uscis.gov/forms/petition-for-a-nonimmigrant-worker/12963010";
    for (const page of capture.pages) {
      expect(pageForUrl(I129_PAGES, base + page.slug)?.slug).toBe(page.slug);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAYER 3 — descriptor <-> backend value map
// ───────────────────────────────────────────────────────────────────────────

// The backend map lives in a SIBLING REPO, present only when that repo is checked
// out beside this one (the dev layout, and in CI only with FAMILY_BACKEND_TOKEN).
// Without it this guard self-skips: a missing secret should cost coverage, not
// block every PR. See coverage.test.ts for the same rule on the I-130.
const HAVE_BACKEND_MAP = existsSync(BACKEND_MAP);

const ALIAS_CASE_TYPES = [
  "H-1B-COS-F2",
  "H-1B-COS-J2",
  "H-1B-COS-H4",
  "H-1B-COS-L2",
  "H-1B-COS-L1",
];

describe.skipIf(!HAVE_BACKEND_MAP)("I-129 descriptor <-> backend value map", () => {
  let mapped: string[] = [];
  let skipped: string[] = [];
  let bundle: Record<string, any> = {};

  beforeAll(() => {
    bundle = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
    const def = bundle["H-1B-COS-F1"].definitions["I-129"];
    mapped = Object.keys(def.field_to_factkey_map);
    skipped = def.skip ?? [];
  });

  it("every backend-mapped field name is one the descriptor drives", () => {
    const driven = new Set(descriptorFieldNames());
    const missing = mapped.filter((n) => !driven.has(n));
    expect(missing, `descriptor missing backend names: ${missing.join(", ")}`).toEqual([]);
  });

  it("every captured field is either mapped or written down in `skip`", () => {
    // The silent-failure guard. A name that is in neither list is a box nobody
    // decided about — and the resolver's answer for an undecided box is "".
    const known = new Set([...mapped, ...skipped]);
    const unaccounted = captureFields()
      .map((f) => f.name)
      .filter((n) => !known.has(n));
    expect(
      unaccounted,
      `captured fields neither mapped nor skipped in the backend bundle: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("puts no name in both the map and the skip list", () => {
    const inMap = new Set(mapped);
    const both = skipped.filter((n) => inMap.has(n));
    expect(both, `both mapped and skipped: ${both.join(", ")}`).toEqual([]);
  });

  it("gives all five alias case types the same definitions", () => {
    for (const code of ALIAS_CASE_TYPES) {
      expect(bundle[code], `${code} has no myUSCIS block`).toBeTruthy();
      expect(bundle[code].definitions_from).toBe("H-1B-COS-F1");
    }
  });
});
