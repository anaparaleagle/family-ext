// Cross-check the I-539 structural descriptor against the LIVE FIELD DUMP
// (test/fixtures/i539-online-field-dump/). This is the I-539 analogue of
// coverage.test.ts — except there is no backend value map for the I-539 yet, so
// the dump is the only source of truth available, and this test guards that seam:
//
//   every fillable field myUSCIS actually renders is either
//     (a) in I539_PAGES  — we drive it, or
//     (b) in I539_SKIP   — we deliberately leave it to the user, on the record.
//
// Nothing may fall between the two. If USCIS adds a field and someone re-captures
// the dump, this test fails until a human classifies it — which is the point.

import { beforeAll, describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { I539_PAGES, I539_SKIP } from "../src/i539/form-descriptor";
import { pageForUrl } from "../src/runner/section-detector";
import { fieldNamesOf } from "../src/runner/types";

// VENDORED into the repo (test/fixtures/) rather than read from a sibling of the
// checkout. It used to resolve to ../../i539-online-field-dump — a directory that
// lived only on one laptop and was tracked in no repo at all, so these tests could
// never run in CI (or for anyone else). The dump is static captured data and is
// exactly what this test asserts against, so it belongs beside the test. Re-capture
// by replacing the files here.
const DUMP_DIR = resolve(__dirname, "fixtures/i539-online-field-dump");
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

// ===========================================================================
// I-539 descriptor <-> BACKEND VALUE MAP
//
// This guard did not exist, and its absence is why three separate bugs shipped:
// the premium-processing radio (backend sent it, descriptor never drove it), the
// /evidence/form-I-20 page (backend routed the I-20 to it, descriptor did not
// declare it so the walk skipped past and the document never uploaded), and the
// six gating ".none" toggles (backend sends them, descriptor skips them, so
// Fill-all stalls on a blank A-Number). Every one of those is the SAME shape:
// an online field or page needs a backend map entry AND a descriptor entry, and
// neither half works alone.
//
// The single entry each of those needed is today's instance. THIS is the fix.
// ===========================================================================

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);
// Sibling repo — present in the local dev layout, and in CI only when the
// FAMILY_BACKEND_TOKEN secret is set. Self-skips rather than failing every PR;
// see the same note in coverage.test.ts.
const HAVE_BACKEND_MAP = existsSync(BACKEND_MAP);

/**
 * Every field name and upload page-path the backend can emit for ANY of the
 * seven I-539 groups. They share one map through `definitions_from` aliases
 * (resolved the way visa_config/loader.py resolves them), but the union is taken
 * rather than assumed so a group that ever gets its own map is still covered.
 */
function loadBackendI539(): {
  mapped: string[];
  uploadPaths: string[];
  emitted: string[];
  backendSkip: string[];
} {
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const mapped = new Set<string>();
  const uploadPaths = new Set<string>();
  // Every name the backend can put a value against, INDEXED REPEATER ROWS
  // INCLUDED. `mapped` stays the flat field map alone (what the three
  // backend->descriptor guards below compare); `emitted` adds the repeater
  // row_map names, normalized `{i}`/`{j}` -> `0` exactly the way fieldNamesOf
  // does, so the descriptor->backend guard compares like with like instead of
  // reporting every repeater cell as unmapped.
  const emitted = new Set<string>();
  const backendSkip = new Set<string>();
  for (const key of Object.keys(json)) {
    if (!key.startsWith("I-539")) continue;
    const entry = json[key].definitions_from ? json[json[key].definitions_from] : json[key];
    const def = entry?.definitions?.["I-539"];
    if (!def) continue;
    for (const name of Object.keys(def.field_to_factkey_map ?? {})) {
      mapped.add(name);
      emitted.add(name);
    }
    for (const page of def.upload_pages ?? []) uploadPaths.add(page.page_path);
    for (const block of Object.values(def.repeaters ?? {}) as { row_map?: object }[]) {
      for (const name of Object.keys(block.row_map ?? {})) {
        emitted.add(name.replace(/\{i\}/g, "0").replace(/\{j\}/g, "0"));
      }
    }
    for (const name of (def.skip ?? []) as string[]) backendSkip.add(name);
  }
  return {
    mapped: [...mapped],
    uploadPaths: [...uploadPaths],
    emitted: [...emitted],
    backendSkip: [...backendSkip],
  };
}

describe.skipIf(!HAVE_BACKEND_MAP)("I-539 descriptor <-> backend value map", () => {
  const driven = new Set(fieldNamesOf(I539_PAGES));
  const skipped = new Set(I539_SKIP);
  let mapped: string[] = [];
  let uploadPaths: string[] = [];
  let emitted: string[] = [];
  let backendSkip: string[] = [];
  // Loaded in beforeAll, not the describe body: skipIf still RUNS the body, so an
  // eager read would throw at collection and take the whole file down.
  beforeAll(() => {
    ({ mapped, uploadPaths, emitted, backendSkip } = loadBackendI539());
  });

  it("drives every field name the backend can emit", () => {
    const missing = mapped.filter((n) => !driven.has(n));
    expect(missing, `backend emits these but the descriptor never fills them: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("never skips a field the backend sends a value for", () => {
    // A name in BOTH the backend map and I539_SKIP is a contradiction: the
    // backend resolves a value and the descriptor throws it away, so USCIS keeps
    // showing a required error and nothing in the log says why.
    const thrownAway = mapped.filter((n) => skipped.has(n));
    expect(
      thrownAway,
      `backend sends these but the descriptor skips them: ${thrownAway.join(", ")}`,
    ).toEqual([]);
  });

  it("has a backend entry for every field the descriptor drives", () => {
    // THE MISSING DIRECTION. The three guards around this one all read
    // backend -> descriptor. Nothing read descriptor -> backend, so a field the
    // descriptor faithfully drives could have no map entry at all and the only
    // symptom was a box that stayed empty on USCIS: resolve_form_myuscis simply
    // never emits the name, planPageFill finds no value, and no log line says a
    // word. That is how the "Travel document number" box on
    // /about-you/your-immigration-information kept being typed by hand
    // (SOF-1278) — the descriptor has driven it since the form was captured.
    //
    // A name may be absent from the map ONLY by appearing in the map's own
    // `skip` list, which is the backend's on-the-record "no fact backs this".
    // That keeps the choice a reviewed one instead of an oversight.
    const covered = new Set([...emitted, ...backendSkip]);
    const unbacked = [...driven].filter((n) => !covered.has(n));
    expect(
      unbacked,
      `the descriptor drives these but the backend map neither maps nor skips them: ${unbacked.join(", ")}`,
    ).toEqual([]);
  });

  it("declares an upload page for every evidence slot the backend can route to", () => {
    // The real guard behind the I-20 bug. A backend slot with no descriptor page
    // means detectCurrentPage finds nothing, fillAll logs "page not in
    // descriptor", clicks past it, and the document is silently missing from the
    // filing. Note /evidence/form-I-20 has a CAPITAL I while its neighbours are
    // lower-case, and matching is case-sensitive — so this compares exactly.
    const uploadSlugs = new Set(
      I539_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug),
    );
    const undeclared = uploadPaths.filter((p) => !uploadSlugs.has(p));
    expect(
      undeclared,
      `backend routes documents to these pages but the descriptor has no upload page: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// SOF-1278 — THE DESCRIPTOR vs THE FORM'S OWN ROUTE TABLE.
//
// The guards above compare the descriptor against the FIELD dump and against the
// backend map. Both assume the descriptor's SLUGS still point at real pages, and
// nothing checked that. myUSCIS moved three of them: it split
// `/about-you/your-immigration-information`,
// `/moral-character/party-and-group-affiliations` and
// `/your-application/information-about-request` into `/…-page-1` children,
// matching the `-page-2` siblings that already sat beside each.
//
// pageForUrl is a path-SUFFIX match, so a URL ending `…-page-1` stops matching
// the bare slug — and pageForHeading cannot cover for it, because every I-539
// page's <h1> is the same sentence. The walk logged "page not in descriptor",
// clicked past, and left the page blank. `your-immigration-information-page-1`
// sits AHEAD of the A-Number page and all four Moral Character pages, which is
// exactly the run of empty sections the law firm reported.
//
// This test reads the form's OWN sidebar, captured live, and asserts the
// descriptor still knows every route it links to. One direction only: the
// evidence section is target-dependent (an H-4 draft shows the H-dependent
// pages and never the F/M ones), so LIVE ⊆ DECLARED is the real invariant.
// Re-capture by replacing the fixture.
// ===========================================================================
const LIVE_SIDEBAR = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/i539-live-sidebar-h4-20260814.json"), "utf-8"),
) as { slugs: string[]; draft_id: string; captured: string };

describe("I-539 descriptor <-> the live myUSCIS route table", () => {
  it("declares every page the live sidebar links to", () => {
    const declared = new Set(I539_PAGES.map((p) => p.slug));
    const undeclared = LIVE_SIDEBAR.slugs.filter((s) => !declared.has(s));
    expect(
      undeclared,
      `myUSCIS serves these pages and the descriptor has no entry, so the walk ` +
        `skips them in silence: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });

  it("matches each live slug by URL, the only signal this form gives us", () => {
    // Belt-and-braces on the guard above: declaring the slug is worth nothing if
    // pageForUrl still resolves it to the WRONG page. Suffix matching makes that
    // a live risk — `/…/your-immigration-information-page-2` ends with neither
    // `-page-1` nor the bare slug, but a careless entry could make two pages
    // shadow each other. Assert the resolved page is the one whose slug it is.
    const base = `https://my.uscis.gov/forms/application-to-extend-change-nonimmigrant-status/${LIVE_SIDEBAR.draft_id}`;
    const wrong = LIVE_SIDEBAR.slugs
      .map((slug) => ({ slug, got: pageForUrl(I539_PAGES, `${base}${slug}`)?.slug ?? null }))
      .filter(({ slug, got }) => got !== slug);
    expect(
      wrong,
      `these live URLs resolve to the wrong descriptor page: ${JSON.stringify(wrong)}`,
    ).toEqual([]);
  });

  it("declares the two H-dependent evidence pages as upload-only", () => {
    // Same shape as the /evidence/form-I-20 bug (SOF-1009): an evidence page the
    // descriptor does not know is a document that never reaches USCIS. These two
    // are the H-4/L-2 slots and they appear on every worker-dependent draft.
    const uploads = new Set(
      I539_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug),
    );
    for (const slug of [
      "/evidence/proof-of-relationship-to-h-temporary-worker",
      "/evidence/additional-evidence-for-dependents-of-h-temporary-worker",
    ]) {
      expect(uploads, `${slug} must be an upload page`).toContain(slug);
    }
  });
});

describe("I-539 descriptor shape", () => {
  it("marks every evidence page as upload-only, in sidebar order", () => {
    const uploads = I539_PAGES.filter((p) => p.kind === "upload");
    expect(uploads.map((p) => p.slug)).toEqual([
      "/evidence/form-i-94",
      // Sits between the I-94 and the written statement on the live sidebar
      // (confirmed on the 2026-07-17 and 2026-07-28 runs).
      "/evidence/form-I-20",
      // Directly after the I-20 on an F/M draft — seen live 2026-07-29 when the
      // walk hit it as an unknown page and stalled there.
      "/evidence/proof-of-ability-to-pay",
      "/evidence/written-statement",
      // SOF-1278: the two H-dependent slots, read off a live H-4 sidebar. The
      // evidence section is TARGET-dependent, so no single order matches every
      // draft — F/M, B and H each see their own subset. What this list is really
      // pinning is that Additional evidence stays LAST, because it is the
      // catch-all and sits last on every sidebar we have seen.
      "/evidence/proof-of-relationship-to-h-temporary-worker",
      "/evidence/additional-evidence-for-dependents-of-h-temporary-worker",
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

  // SOF-1004: the preparer MOBILE was left in I539_SKIP by SOF-892 because the
  // backend had no firm mobile to send. It does now (firm.mobile_phone, mapped in
  // the backend's I-539 map), so leaving it skipped means the backend emits the
  // value and the descriptor throws it away — USCIS keeps showing a required error.
  it("drives the preparer mobile phone from the firm profile", () => {
    const preparer = I539_PAGES.find((p) => p.slug === "/getting-started/preparer")!;
    const mobile = preparer.fields.find(
      (f) => f.name === "gettingStarted.preparer.contact.mobilePhone",
    );
    // A phone field, so the engine types it into the masked input the same way it
    // types the daytime phone (both arrive digits-only from the backend).
    expect(mobile?.kind).toBe("phone");
  });

  // SOF-1004: USCIS wants the number OR the "no mobile" tick, never both and never
  // neither — a blank required field holds the page. The backend decides which by
  // resolving the checkbox off the same fact, so the descriptor must carry it.
  it("drives the no-mobile-phone tick so a firm without a mobile can still pass the page", () => {
    const preparer = I539_PAGES.find((p) => p.slug === "/getting-started/preparer")!;
    const noMobile = preparer.fields.find(
      (f) => f.name === "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone",
    );
    expect(noMobile?.kind).toBe("checkbox");
  });
});
