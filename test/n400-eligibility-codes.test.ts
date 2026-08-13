// ===========================================================================
// SOF-1267 — WHO OWNS THE N-400 ELIGIBILITY-BASIS VOCABULARY.
//
// Answer: the BACKEND does, and this file holds the extension to that.
//
// The value->code mapping (our answer vocabulary -> the USCIS option code) lives
// in ONE place, in the other repo:
//
//   paraleagle-family-backend/family_visa/forms/transforms.py
//     `_N400_ELIGIBILITY`  (general_5yr -> "191", spouse_3yr -> "192", ...)
//   paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json
//     "gettingStarted.changeBasisForEligibility.eligibilityCode":
//        { "key": "applicant.eligibility_basis", "transform": "n400_eligibility_code" }
//
// By the time a value reaches this extension it is ALREADY the code. The
// descriptor's option list is not a translation table and must never become one —
// `radio(name, options)` only tells the value-setter "this string is an option
// value, click the input whose value matches" (see src/runner/types.ts and the
// value-setter). It never maps anything.
//
// What is left to guard is DRIFT. The seven codes are written down twice, in two
// repos, with nothing holding them together, and the backend's CI cannot see this
// repo. So:
//
//   1. the descriptor's option list is pinned to the live capture (always runs);
//   2. it is cross-checked against the backend transform when the backend repo is
//      beside us, which is the layout CI creates (see .github/workflows/ci.yml);
//   3. the extension is asserted NOT to carry our answer vocabulary at all, so a
//      re-added mapping fails here instead of quietly becoming a second source of
//      truth that can disagree with the backend.
//
// If you are reading this because the test is red: the fix is on the BACKEND
// side, or it is deleting whatever re-introduced a mapping here. It is NOT adding
// a mapping to the descriptor.
// ===========================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { N400_PAGES } from "../src/n400/form-descriptor";
import type { DescriptorField } from "../src/runner/types";

const ELIGIBILITY_FIELD = "gettingStarted.changeBasisForEligibility.eligibilityCode";

const DESCRIPTOR_SRC = resolve(__dirname, "../src/n400/form-descriptor.ts");

/**
 * Every field the N-400 descriptor declares. `page.fields` really is all of them:
 * repeater rows live here too, carrying `{i}` in their names, and a row VARIANT
 * is only a list of names (RowVariantSpec.shapes), not more field objects.
 */
const ALL_FIELDS: DescriptorField[] = N400_PAGES.flatMap((p) => p.fields);

function eligibilityField(): DescriptorField {
  const field = ALL_FIELDS.find((f) => f.name === ELIGIBILITY_FIELD);
  if (!field) {
    throw new Error(
      `${ELIGIBILITY_FIELD} is not declared in src/n400/form-descriptor.ts. The backend ` +
        `emits this field (form_myuscis_definitions.json, transform "n400_eligibility_code"), ` +
        `so without a descriptor entry nothing types the basis of eligibility.`,
    );
  }
  return field;
}

const sorted = (values: readonly string[]) => [...values].sort();

// ───────────────────────────────────────────────────────────────────────────
// 1 — PIN THE OPTION LIST
//
// Anchored to the vendored live capture rather than to a fresh hand-written copy,
// because a third copy of the codes is exactly the problem this file exists to
// stop. The dump is what USCIS actually rendered (draft 13370795, 2026-07-30).
// ───────────────────────────────────────────────────────────────────────────

const CAPTURED_CODES: string[] = Object.keys(
  JSON.parse(
    readFileSync(resolve(__dirname, "fixtures/n400-online-field-dump/04-consolidated.json"), "utf-8"),
  ).OPTION_CODE_TABLES[ELIGIBILITY_FIELD].codes,
);

describe("N-400 eligibility basis: the descriptor's option list", () => {
  it("carries exactly the seven codes USCIS rendered, no more and no fewer", () => {
    const options = eligibilityField().options ?? [];
    expect(sorted(options)).toEqual(sorted(CAPTURED_CODES));
    // Non-vacuous: the capture really did have seven, so a dump that lost its
    // table cannot make this pass by comparing two empty lists.
    expect(CAPTURED_CODES.length).toBe(7);
  });

  it("lists each code once", () => {
    const options = eligibilityField().options ?? [];
    // A duplicate is silent: the value-setter finds the first match and the second
    // entry never shows up in any log.
    expect(options.length).toBe(new Set(options).size);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 — THE DESCRIPTOR DOES NOT TRANSLATE
//
// The regression guard. The extension is data-agnostic by design: it receives
// {field_name: value} and types it. Our fact-side answer vocabulary must not
// appear here in ANY form — not as a lookup, not as a comment that reads like
// one — because a second copy of the mapping can drift from the backend's and
// nothing would notice until a naturalisation application is filed on the wrong
// eligibility basis.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The fact-side keys of `_N400_ELIGIBILITY` in the backend's transforms.py.
 *
 * "other" is deliberately absent — it is too common a word to scan a source file
 * for. The six below are unambiguous: if one of them appears in this extension,
 * someone has copied the backend's vocabulary across the seam.
 */
const BACKEND_ANSWER_VOCABULARY = [
  "general_5yr",
  "spouse_3yr",
  "vawa",
  "spouse_employed_abroad",
  "military_hostilities",
  "military_one_year",
];

describe("N-400 eligibility basis: the extension owns no vocabulary", () => {
  it("declares the field as a plain radio over opaque USCIS codes", () => {
    const field = eligibilityField();
    expect(field.kind).toBe("radio");
    // Every option is a bare numeric code. Anything word-shaped here would mean
    // one of OUR answer values had been written into the option list, which is
    // the shape a translation table takes when it creeps back in.
    const wordShaped = (field.options ?? []).filter((o) => !/^\d+$/.test(o));
    expect(
      wordShaped,
      `these options are not USCIS codes: ${wordShaped.join(", ")}. The descriptor lists ` +
        `option VALUES only. Our answer vocabulary belongs in _N400_ELIGIBILITY in ` +
        `paraleagle-family-backend/family_visa/forms/transforms.py, applied through ` +
        `form_myuscis_definitions.json.`,
    ).toEqual([]);
  });

  it("hangs no mapping off any descriptor field", () => {
    // A value->code table added later would have to arrive as a new property on a
    // DescriptorField. Pinning the property set makes that visible instead of
    // letting it ride along unnoticed.
    // Exactly the properties DescriptorField declares (src/runner/types.ts).
    const allowed = new Set(["name", "kind", "options", "conditional", "revealedBy", "locate"]);
    const unexpected = [
      ...new Set(ALL_FIELDS.flatMap((f) => Object.keys(f)).filter((k) => !allowed.has(k))),
    ];
    expect(
      unexpected,
      `unrecognised property on an N-400 descriptor field: ${unexpected.join(", ")}. If this ` +
        `is a value mapping, it belongs in the backend (transforms.py + ` +
        `form_myuscis_definitions.json), not here. If it is a genuinely new field ` +
        `capability, add it to this allow-list on purpose.`,
    ).toEqual([]);
  });

  it("never names our answer values, in code or in comment", () => {
    const src = readFileSync(DESCRIPTOR_SRC, "utf-8");
    const found = BACKEND_ANSWER_VOCABULARY.filter((word) => src.includes(word));
    expect(
      found,
      `src/n400/form-descriptor.ts names our fact-side answer values (${found.join(", ")}), ` +
        `which claims a mapping the extension does not own and cannot keep in step. The ` +
        `mapping is _N400_ELIGIBILITY in paraleagle-family-backend/family_visa/forms/` +
        `transforms.py, applied via "transform": "n400_eligibility_code" in ` +
        `family_visa/visa_config/bundles/form_myuscis_definitions.json. Say that instead of ` +
        `restating the table.`,
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 — CROSS-REPO DRIFT GUARD
//
// Self-skips when the backend repo is not beside us, matching every other
// cross-repo guard in this suite (test/coverage.test.ts, i539-coverage,
// n400-coverage). CI checks the backend out at that path when the
// FAMILY_BACKEND_TOKEN secret is set.
// ───────────────────────────────────────────────────────────────────────────

const BACKEND_TRANSFORMS = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/forms/transforms.py",
);
const HAVE_BACKEND = existsSync(BACKEND_TRANSFORMS);

/** The codes `n400_eligibility_code` can return, read out of the backend source. */
function backendEligibilityCodes(): string[] {
  const src = readFileSync(BACKEND_TRANSFORMS, "utf-8");
  const block = /_N400_ELIGIBILITY\s*=\s*\{([\s\S]*?)\}/.exec(src);
  if (!block) {
    throw new Error(
      `_N400_ELIGIBILITY was not found in ${BACKEND_TRANSFORMS}. It is the source of truth ` +
        `for the N-400 eligibility codes; if it was renamed, this guard needs to follow it, ` +
        `not be deleted.`,
    );
  }
  return [...block[1].matchAll(/"[^"]+"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
}

describe.skipIf(!HAVE_BACKEND)("N-400 eligibility basis: descriptor <-> backend transform", () => {
  it("knows every code the backend transform can emit", () => {
    // The dangerous direction. A code the backend sends but the descriptor does
    // not list is not treated as an option value, so the radio is driven as if it
    // were free text and the answer never commits.
    const options = new Set(eligibilityField().options ?? []);
    const unknown = backendEligibilityCodes().filter((c) => c && !options.has(c));
    expect(
      unknown,
      `_N400_ELIGIBILITY in paraleagle-family-backend/family_visa/forms/transforms.py emits ` +
        `these codes, which src/n400/form-descriptor.ts does not list: ${unknown.join(", ")}. ` +
        `The backend is the source of truth for this vocabulary — add the codes to the ` +
        `descriptor's option list; do not add a mapping.`,
    ).toEqual([]);
  });

  it("has not drifted apart from it", () => {
    // Exact equality holds today (both sides carry the same seven). If it stops
    // holding, a human should look: it means either USCIS changed its options or
    // the firm stopped mapping a basis, and only one of those is fine.
    const backend = backendEligibilityCodes().filter(Boolean);
    expect(
      sorted(eligibilityField().options ?? []),
      `the descriptor's option list and _N400_ELIGIBILITY (transforms.py, applied via ` +
        `form_myuscis_definitions.json) no longer describe the same seven bases of ` +
        `eligibility.`,
    ).toEqual(sorted(backend));
  });
});
