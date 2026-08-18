// ===========================================================================
// N-400 COVERAGE GUARD — built BEFORE the descriptor and the backend map, on
// purpose.
//
// The I-539 taught this the expensive way: four separate defects shipped because
// an online field or upload page needs a BACKEND MAP entry *and* a DESCRIPTOR
// entry, and neither half works alone. test/i539-coverage.test.ts caught all four
// on its first run — after they had shipped. So for the N-400 the guard lands
// first and the entries get written against it.
//
// This file has three layers:
//
//   1. CAPTURED-FACT LOCKS (always run). The live capture cost a long session and
//      produced facts that are non-obvious and easy to "tidy" into something
//      wrong — opaque non-sequential option codes, a slug with an odd capital
//      letter, a state name with a capital "Of". These tests assert those exact
//      values against the vendored dump. If someone re-captures and the values
//      move, this fails and a human has to look, which is the point.
//
//   2. DESCRIPTOR <-> DUMP (self-skips until src/n400/form-descriptor.ts exists).
//
//   3. DESCRIPTOR <-> BACKEND MAP (self-skips until both exist).
//
// Layers 2 and 3 are written now so that the moment the descriptor lands, the
// drift guard is already watching it.
// ===========================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pageForUrl } from "../src/runner/section-detector";
import { onTerminalPath } from "../src/runner/fill-chain";
import type { FormPage } from "../src/runner/types";

const DUMP_DIR = resolve(__dirname, "fixtures/n400-online-field-dump");

const read = (file: string) => JSON.parse(readFileSync(resolve(DUMP_DIR, file), "utf-8"));

const UNCONDITIONAL = read("01-unconditional-pages.json");
const REVEALS = read("02-reveals-and-repeaters.json");
const WALK = read("03-committed-walk.json");
const CONSOLIDATED = read("04-consolidated.json");
const MATRIX = read("05-path-matrix.json");

// The gap-closure findings (uniform upload control, shared country/state lists,
// the disappearing-pages note) were appended to the CONSOLIDATED file, not to the
// committed-walk file where they chronologically belong. Aliased here so the
// tests read one obvious name instead of the reader having to know that.
const GAP = CONSOLIDATED.GAP_CLOSURE_PASS;

// ───────────────────────────────────────────────────────────────────────────
// LAYER 1 — captured-fact locks
// ───────────────────────────────────────────────────────────────────────────

describe("N-400 capture: the vendored dump is intact", () => {
  it("holds the unconditional page set with its field counts", () => {
    const pages = UNCONDITIONAL.pages as Array<{ s: string; f: unknown[] }>;
    expect(pages.length).toBe(34);
    const fieldTotal = pages.reduce((a, p) => a + p.f.length, 0);
    expect(fieldTotal).toBe(112);
  });

  it("uses four distinct top-level Formik namespaces", () => {
    // A map author who assumes everything is applicant.* misses two thirds of
    // this form. The I-539 really is almost all applicant.*; the N-400 is not.
    const names = (UNCONDITIONAL.pages as Array<{ f: Array<{ n: string }> }>)
      .flatMap((p) => p.f.map((f) => f.n))
      .filter((n) => n.includes("."));
    const roots = new Set(
      names.map((n) => (n.startsWith("formikFactoryUIMeta.") ? "formikFactoryUIMeta" : n.split(".")[0])),
    );
    expect([...roots].sort()).toEqual([
      "applicant",
      "formikFactoryUIMeta",
      "gettingStarted",
      "moralCharacter",
      "yourFamily",
    ]);
  });
});

describe("N-400 capture: option codes are opaque and must not be re-derived", () => {
  const codes = CONSOLIDATED.OPTION_CODE_TABLES;

  it("locks the eligibility-basis codes, which are NOT in display order", () => {
    const table = codes["gettingStarted.changeBasisForEligibility.eligibilityCode"].codes;
    expect(table["191"]).toBe("General provision");
    expect(table["192"]).toBe("Spouse of a U.S. citizen");
    expect(table["195"]).toBe("Other");
    // The give-away that order cannot be trusted: 189 sits THIRD on screen.
    expect(table["189"]).toMatch(/Violence Against Women Act/);
    expect(Object.keys(table).length).toBe(7);
  });

  it("locks marital status, where Separated is 7 and 5 is Marriage annulled", () => {
    // Reading these positionally files "Marriage annulled" for a separated
    // applicant. That is a wrong answer on a naturalisation application.
    const table = codes["yourFamily.maritalStatus.status"].codes;
    expect(table["7"]).toBe("Separated");
    expect(table["5"]).toBe("Marriage annulled");
    expect(table["2"]).toBe("Married");
  });

  it("locks gender as 3=Male / 1=Female", () => {
    // Same pair already confirmed live on the I-130, so it is a myUSCIS-wide
    // convention rather than a one-off — but it still reads backwards.
    const table = codes["applicant.describeYourself.gender"].codes;
    expect(table["3"]).toBe("Male");
    expect(table["1"]).toBe("Female");
  });

  it("locks the race checkbox codes and records that there is no code 4", () => {
    // These checkboxes have BARE NUMERIC names — no Formik path at all — so any
    // selector keyed on a dotted path will never find them.
    const table = codes["applicant.describeYourself.race_checkboxes"].codes;
    expect(Object.keys(table).sort()).toEqual(["1", "2", "3", "5", "6"]);
    expect(table["4"]).toBeUndefined();
    expect(table["1"]).toBe("White");
  });

  it("records that code style is INCONSISTENT across this one form", () => {
    // Numeric, word-code and full-display-text all coexist. Any helper that
    // assumes one style will silently fail on the others.
    expect(codes["yourFamily.currentSpouse.currentSpouse2.spouseBecameCitizen"].codes["byBirth"])
      .toBe("By Birth in the United States");
    const residence = codes["yourFamily.children.childrenInformation.{i}.childInfo.residence"].codes;
    // The code and the LABEL differ on this one option.
    expect(residence["Unknown"]).toBe("Unknown/Missing");
  });
});

describe("N-400 capture: autocomplete option text must match byte for byte", () => {
  const lists = CONSOLIDATED.AUTOCOMPLETE_OPTION_LISTS;

  it("records the state list's capital 'Of' as captured", () => {
    // "District Of Columbia" — a capital O, where reference data says "of".
    //
    // This pins what the live list ACTUALLY says. It is NOT a bug: the
    // value-setter's exact-label pass lowercases both sides, so the backend's
    // "District of Columbia" matches fine. An earlier version of this comment
    // claimed it would silently fail — that was wrong, and worth not re-deriving.
    // Case differences are safe here; a missing LETTER ("Blond" for "Blonde")
    // is not, which is what the hair/eye assertions below actually guard.
    const states: string[] = GAP.SHARED_AUTOCOMPLETE_LISTS.state.firstFew;
    expect(states).toContain("District Of Columbia");
    expect(states).not.toContain("District of Columbia");
    expect(states).toContain("Federated States Of Micronesia");
  });

  it("keeps the exact hair and eye colour spellings", () => {
    expect(lists["applicant.describeYourself.hairColor"]).toContain("Blonde");
    expect(lists["applicant.describeYourself.hairColor"]).not.toContain("Blond");
    expect(lists["applicant.describeYourself.hairColor"]).toContain("Bald (no hair)");
    expect(lists["applicant.describeYourself.eyeColor"]).toContain("Unknown/Other");
    // "Gray" not "Grey" — both lists use the US spelling.
    expect(lists["applicant.describeYourself.eyeColor"]).toContain("Gray");
  });

  it("records occupation as a CLOSED list our free-text fact cannot satisfy", () => {
    // applicant.employment_education_history[i].occupation_or_field is free text
    // ("Software Engineer"). This field only accepts one of 29 categories, so the
    // backend needs a classifier. This test exists to stop anyone wiring the raw
    // free-text value straight through.
    const occ = MATRIX.OCCUPATION_IS_A_CLOSED_LIST;
    expect(occ.kind).toMatch(/closed list/i);
    expect(occ.options.length).toBe(29);
    expect(occ.options).toContain("I.T. Software Development");
    // USCIS duplicates one entry in its own list: 29 entries, 28 distinct.
    expect(new Set(occ.options).size).toBe(28);
  });
});

describe("N-400 capture: evidence pages", () => {
  const walk = WALK;

  it("keeps the odd capital letter in the alternative-sentencing slug", () => {
    // /evidence/Alternative-sentencing-or-rehabilitative-programs has a capital
    // A while its neighbours are lower-case, and page matching is a
    // case-sensitive path compare. Verified live: the page loads ONLY with the
    // capital. Lower-casing it would look wired and upload nothing — exactly
    // what happened to the I-539's /evidence/form-I-20.
    const slugs: string[] = walk.ALL_TWELVE_EVIDENCE_PAGES.slugs;
    expect(slugs).toContain("/evidence/Alternative-sentencing-or-rehabilitative-programs");
    expect(slugs).not.toContain("/evidence/alternative-sentencing-or-rehabilitative-programs");
  });

  it("records the single uniform upload control, keyed by id and not name", () => {
    const shape = GAP.ALL_12_EVIDENCE_PAGES_VERIFIED_IDENTICAL.shape;
    expect(shape.id).toBe("desktop-drop");
    // No name attribute — a name-keyed selector finds nothing here.
    expect(shape.name).toBeNull();
    expect(shape.multiple).toBe(true);
    expect(shape.typedFields).toBe(0);
  });

  it("records that PNG is NOT an accepted upload type", () => {
    // Our document set includes photos. This input rejects PNG, so it should be
    // refused or converted server-side the way too_big_for_uscis already is.
    const shape = GAP.ALL_12_EVIDENCE_PAGES_VERIFIED_IDENTICAL.shape;
    expect(shape.accept).not.toMatch(/png/i);
    expect(shape.accept).toMatch(/application\/pdf/);
  });

  it("records that eligibility basis changes ONLY evidence pages", () => {
    // Useful scoping fact: the backend map's FIELD side needs no eligibility
    // branching at all. Only upload_pages does.
    const m = MATRIX.ELIGIBILITY_BASIS_MATRIX.result;
    expect(m.everyVaryingPageIsAnEvidencePage).toBe(true);
    expect(m.pagesCommonToAllSixCodes).toBe(48);
  });
});

describe("N-400 capture: the reveal rule the map can DERIVE", () => {
  it("states the .question -> .additionalExplanation rule with a negative control", () => {
    // Every moral-character `<x>.question` radio has a sibling
    // `<x>.additionalExplanation` textarea revealed by answering Yes; a field
    // WITHOUT the suffix has no explain sibling. That covers ~35 fields
    // mechanically instead of one capture at a time.
    const rule = REVEALS.THE_BIG_RULE;
    expect(rule.proven_on.length).toBeGreaterThanOrEqual(4);
    expect(rule.negative_control).toMatch(/per-question/);
    expect(rule.no_suffix_no_explain).toContain("moralCharacter.crimesAndOffenses.committedCrime");
  });

  it("holds every moral-character question field the capture saw", () => {
    const questionFields = (UNCONDITIONAL.pages as Array<{ f: Array<{ n: string }> }>)
      .flatMap((p) => p.f.map((f) => f.n))
      .filter((n) => n.startsWith("moralCharacter.") && n.endsWith(".question"));
    // If this number moves, the derived explain set moves with it. 39 is the
    // measured count from the live capture — every one of these gets a sibling
    // `.additionalExplanation` textarea when answered Yes.
    expect(questionFields.length).toBe(39);
  });
});

describe("N-400 capture: repeaters", () => {
  const repeaters = REVEALS.repeaters as Array<Record<string, unknown>>;

  it("declares every repeater with an add label", () => {
    expect(repeaters.length).toBe(6);
    for (const r of repeaters) expect(r.addButtonText, `no add label for ${r.page}`).toBeTruthy();
  });

  it("keeps the row-commit labels distinct, because they really are", () => {
    // Five different labels across seven repeaters, plus a bare "Add". One regex
    // cannot drive these and a loose /add/ matcher hits several at once — the
    // I-539 already lost builds to exactly this.
    const matrix = CONSOLIDATED.REPEATER_BUTTON_MATRIX.rows as Array<{ add: string; commit: string }>;
    const commits = new Set(matrix.map((r) => r.commit));
    expect(commits.has("Save entry")).toBe(true);
    expect(commits.has("Save child")).toBe(true);
    expect(commits.has("Save")).toBe(true);
    expect(commits.has("Save response")).toBe(true);
    // A bare "Add" exists and is the dangerous one for substring matching.
    expect(matrix.some((r) => r.add === "Add")).toBe(true);
  });

  it("flags the NESTED repeater, which the current descriptor type cannot express", () => {
    // Trip rows each contain a countries.{j} list with its own Add button.
    // RepeaterSpec carries a single namePrefix + addButtonText, so this needs a
    // type change before travel can be driven at all.
    const travel = repeaters.find((r) => String(r.page).includes("travel-outside-the-us"))!;
    expect(travel.NESTED_REPEATER).toBeTruthy();
  });

  it("flags the POLYMORPHIC employment repeater's four row shapes", () => {
    // One repeater, four row shapes chosen by an autocomplete. A single static
    // row_map cannot serve all four: unemployment has no address and no
    // occupation, and school swaps employmentInfo.* for schoolInfo.*.
    const shapes = CONSOLIDATED.schools_and_employment_ALL_FOUR_ROW_SHAPES;
    expect(Object.keys(shapes.shapes).length).toBe(4);
    expect(shapes.shapes["Add a period of unemployment"]).not.toContain("address.city");
    expect(shapes.shapes["Add a school"]).toContain("schoolInfo.schoolName");
  });

  it("uses additionalInformationTable, NOT the I-539's additionalInformationArray", () => {
    // Same Add label ("Add a response"), different field prefix. Assuming they
    // matched would have produced a map that fills nothing.
    const addl = CONSOLIDATED.newly_captured_pages["/additional-information/additional-information"];
    expect(addl.namePrefix).toBe("additionalInformationTable");
    expect(addl.rowFields).toContain("additionalInformationTable.{i}.response");
  });
});

describe("N-400 capture: things that are NOT true of this form", () => {
  it("has no applicant/beneficiary inversion", () => {
    // The I-130 trap. The N-400 is single-party, so beneficiary.* must never
    // appear and petitioner.* has no meaning here.
    const names = (UNCONDITIONAL.pages as Array<{ f: Array<{ n: string }> }>)
      .flatMap((p) => p.f.map((f) => f.n));
    expect(names.filter((n) => n.startsWith("beneficiary."))).toEqual([]);
    expect(names.filter((n) => n.startsWith("petitioner."))).toEqual([]);
  });

  it("records that prior-marriage detail cannot be filed online at all", () => {
    // All six marital statuses tested with numberOfTimesMarried committed. None
    // produces prior-marriage typed fields — online takes that substance as
    // DOCUMENTS only. The paper form does have the fields, so PDF facts have
    // nowhere to go here. A mapping decision, not a bug to fix in the extension.
    const pm = MATRIX.MARITAL_STATUS_MATRIX.PRIOR_MARRIAGE_NOW_CONCLUSIVE;
    expect(pm).toMatch(/SIX marital statuses/);
    expect(pm).toMatch(/ONLY as documents/);
  });

  it("records that pages can DISAPPEAR, so reachability is per-scenario", () => {
    // Married -> Divorced REMOVED both current-spouse pages. A guard asserting
    // "every descriptor page is reachable" would therefore be wrong.
    expect(GAP.PAGES_CAN_DISAPPEAR_TOO.finding).toMatch(/REMOVED/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAYER 2 — descriptor <-> dump. Self-skips until the descriptor is authored.
// ───────────────────────────────────────────────────────────────────────────

const DESCRIPTOR_PATH = resolve(__dirname, "../src/n400/form-descriptor.ts");
const HAVE_DESCRIPTOR = existsSync(DESCRIPTOR_PATH);

// Non-literal specifier on purpose: a literal would make `tsc --noEmit` try to
// resolve a module that does not exist yet and fail the typecheck for everyone.
const DESCRIPTOR_SPECIFIER = "../src/n400/form-descriptor";

describe.skipIf(!HAVE_DESCRIPTOR)("N-400 descriptor <-> live dump", () => {
  let driven = new Set<string>();
  let skipped = new Set<string>();
  let pages: FormPage[] = [];

  beforeAll(async () => {
    const mod = await import(/* @vite-ignore */ DESCRIPTOR_SPECIFIER);
    pages = mod.N400_PAGES;
    driven = new Set(
      pages.flatMap((p) => p.fields.map((f) => f.name.replace(/\{i\}/g, "0").replace(/\{j\}/g, "0"))),
    );
    skipped = new Set(mod.N400_SKIP ?? []);
  });

  it("accounts for every captured field — driven or explicitly skipped", () => {
    const captured = (UNCONDITIONAL.pages as Array<{ f: Array<{ n: string }> }>)
      .flatMap((p) => p.f.map((f) => f.n))
      // Bare numeric names are the race checkboxes; they cannot be matched by
      // path and are handled by label, so they are excluded here.
      .filter((n) => n.includes("."));
    const unaccounted = captured.filter((n) => !driven.has(n) && !skipped.has(n));
    expect(unaccounted, `captured but neither driven nor skipped: ${unaccounted.join(", ")}`).toEqual([]);
  });

  it("never both drives and skips the same field", () => {
    const both = [...skipped].filter((n) => driven.has(n));
    expect(both, `both driven and skipped: ${both.join(", ")}`).toEqual([]);
  });

  it("declares an upload page for all twelve evidence slugs, case-exact", () => {
    const walk = read("03-committed-walk.json");
    const uploadSlugs = new Set(pages.filter((p) => p.kind === "upload").map((p) => p.slug));
    const missing = (walk.ALL_TWELVE_EVIDENCE_PAGES.slugs as string[]).filter((s) => !uploadSlugs.has(s));
    expect(missing, `evidence pages with no descriptor upload entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("terminates on the review page and puts it last", () => {
    const reviews = pages.filter((p) => p.kind === "review");
    expect(reviews.map((p) => p.slug)).toEqual(["/review-and-submit/review-your-application"]);
    expect(reviews[0].fields).toEqual([]);
    expect(pages[pages.length - 1].kind).toBe("review");
  });

  it("has unique slugs", () => {
    const slugs = pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps the descriptor page order in the captured sidebar order", () => {
    // The walk advances with the form's own Next buttons, so descriptor order IS
    // the walk order. If it disagrees with the sidebar, the chain looks for the
    // wrong page next and pages get skipped — a silent coverage hole rather than
    // an error. The dump's `pages` array preserves the live sidebar sequence, so
    // the relative order of everything present in both must match exactly.
    const dumpOrder = (UNCONDITIONAL.pages as Array<{ s: string }>).map((p) => p.s);
    const descriptorOrder = pages.map((p) => p.slug);
    const shared = new Set(dumpOrder.filter((s) => descriptorOrder.includes(s)));
    // Guard against a vacuous pass: if the two sides shared nothing, the
    // comparison below would trivially hold and prove nothing.
    expect(shared.size, "descriptor and dump share no pages — comparison is vacuous")
      .toBeGreaterThanOrEqual(30);
    expect(
      descriptorOrder.filter((s) => shared.has(s)),
      "descriptor page order diverges from the captured sidebar order",
    ).toEqual(dumpOrder.filter((s) => shared.has(s)));
  });

  it("detects every page from its real live URL, with no mis-detection", () => {
    // Runs the ACTUAL detector against the real URL shape rather than reasoning
    // about slug structure. An earlier version of this test asserted a property
    // of suffix-related slug pairs and passed while finding zero such pairs —
    // vacuously. This version cannot: every page must round-trip to itself.
    //
    // The risk being checked is real. pageForUrl matches by path SUFFIX and
    // relies on sorting longest-slug-first, so a page whose slug is a suffix of
    // another's would resolve to the wrong page — and this form has several
    // sub-pages nested under a parent of the same name
    // (/moral-character/crimes-and-offenses/crimes-and-offenses-page-2).
    const BASE = "https://my.uscis.gov/forms/application-for-naturalization/13370795";
    const mismatches: string[] = [];
    for (const page of pages) {
      const got = pageForUrl(pages, `${BASE}${page.slug}`);
      if (got?.slug !== page.slug) mismatches.push(`${page.slug} -> ${got?.slug ?? "NO MATCH"}`);
    }
    expect(mismatches, `pages that do not detect as themselves: ${mismatches.join(", ")}`).toEqual([]);
    // Non-vacuous by construction: it asserted once per page.
    expect(pages.length).toBeGreaterThan(40);
  });

  // ── THE PAGES THAT CAME UP BLANK ON THE LIVE RUN ──────────────────────────
  // Same defect as the I-539's (SOF-1278, fixed there by rewriting three slugs):
  // myUSCIS nests a page under itself once it gains a sibling, so the bare route
  // this capture recorded is served as a `-page-1` CHILD beside the `-page-2`.
  // pageForUrl matches by suffix, so the bare slug matched nothing; every page's
  // <h1> is identical, so the heading fallback could not cover for it; and the
  // walk logged "page not in descriptor" and clicked past whole sections.
  //
  // Fixed as a RULE in the matcher rather than by editing slugs: there is no live
  // N-400 capture, so which pages have moved is not knowable here, and a draft
  // made before a split still serves the bare route. Both forms must resolve.
  const LIVE_BASE = "https://my.uscis.gov/forms/application-for-naturalization/13370795";

  it("resolves the -page-1 route for the sections the live run left blank", () => {
    // Hard-coded URLs, not derived from the slug, so this reads as the report did.
    const reported: Array<[string, string]> = [
      [
        "/about-you/your-immigration-information/your-immigration-information-page-1",
        "/about-you/your-immigration-information",
      ],
      [
        "/moral-character/party-or-group-affiliations/party-or-group-affiliations-page-1",
        "/moral-character/party-or-group-affiliations",
      ],
      [
        "/moral-character/good-moral-character/good-moral-character-page-1",
        "/moral-character/good-moral-character",
      ],
      [
        "/moral-character/crimes-and-offenses/crimes-and-offenses-page-1",
        "/moral-character/crimes-and-offenses",
      ],
      ["/moral-character/illegal-activity/illegal-activity-page-1", "/moral-character/illegal-activity"],
      ["/moral-character/military-service/military-service-page-1", "/moral-character/military-service"],
      [
        "/moral-character/attachment-to-the-us-constitution/attachment-to-the-us-constitution-page-1",
        "/moral-character/attachment-to-the-us-constitution",
      ],
      ["/moral-character/oath-of-allegiance/oath-of-allegiance-page-1", "/moral-character/oath-of-allegiance"],
    ];
    const wrong = reported
      .map(([url, want]) => ({ url, want, got: pageForUrl(pages, `${LIVE_BASE}${url}`)?.slug ?? null }))
      .filter(({ want, got }) => got !== want);
    expect(wrong, `page-1 routes that do not resolve: ${JSON.stringify(wrong)}`).toEqual([]);
    // The pages must arrive with their fields, which is the whole point.
    const gmc = pageForUrl(pages, `${LIVE_BASE}/moral-character/good-moral-character/good-moral-character-page-1`);
    expect(gmc?.fields.length).toBeGreaterThan(0);
  });

  it("resolves EVERY page from its -page-1 route, with no page shadowing another", () => {
    // Descriptor-wide, because the rule applies to every page: the reported ones
    // are just the ones a firm happened to hit. A page whose alias resolves to
    // some OTHER page would fill the wrong section, which is worse than blank.
    const mismatches: string[] = [];
    for (const page of pages) {
      const last = page.slug.slice(page.slug.lastIndexOf("/") + 1);
      const url = `${LIVE_BASE}${page.slug}/${last}-page-1`;
      const got = pageForUrl(pages, url);
      if (got?.slug !== page.slug) mismatches.push(`${page.slug} -> ${got?.slug ?? "NO MATCH"}`);
    }
    expect(mismatches, `page-1 routes resolving to the wrong page: ${mismatches.join(", ")}`).toEqual([]);
    expect(pages.length).toBeGreaterThan(40);
  });

  it("keeps every declared -page-2/-page-3 slug winning for its own URL", () => {
    // The alias must never swallow a sibling that is declared as it is served.
    // Exact matching runs as a complete pass BEFORE any alias is considered.
    const declaredSiblings = pages.map((p) => p.slug).filter((s) => /-page-[23]$/.test(s));
    expect(declaredSiblings.length).toBeGreaterThanOrEqual(5);
    for (const slug of declaredSiblings) {
      expect(pageForUrl(pages, `${LIVE_BASE}${slug}`)?.slug, slug).toBe(slug);
    }
  });

  it("still returns null for a route the descriptor does not know", () => {
    // The alias is one exact extra form, not a fuzzy match. Everything else has
    // to stay unknown, because "unknown" is what makes the walk skip instead of
    // typing a section's answers into the wrong page.
    for (const url of [
      "https://my.uscis.gov/account/dashboard",
      `${LIVE_BASE}/moral-character/good-moral-character/good-moral-character-page-4`,
      `${LIVE_BASE}/moral-character/good-moral-character-page-1`,
      `${LIVE_BASE}/moral-character/good-moral-character/something-else-page-1`,
      `${LIVE_BASE}/a-section-uscis-has-not-shipped-yet`,
    ]) {
      expect(pageForUrl(pages, url), url).toBeNull();
    }
  });

  it("leaves the review stop intact, bare route or -page-1 route", () => {
    // The review page must keep resolving to its `kind: "review"` entry (the
    // walk's stop) and must stay inside onTerminalPath either way — the alias
    // must not turn the terminal section into something the walk types on.
    const review = "/review-and-submit/review-your-application";
    expect(pageForUrl(pages, `${LIVE_BASE}${review}`)?.kind).toBe("review");
    const aliased = `${LIVE_BASE}${review}/review-your-application-page-1`;
    expect(pageForUrl(pages, aliased)?.kind).toBe("review");
    expect(onTerminalPath(`${LIVE_BASE}${review}`)).toBe(true);
    expect(onTerminalPath(aliased)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LAYER 3 — descriptor <-> backend map. The guard whose absence let four I-539
// defects ship. Self-skips until both sides exist.
// ───────────────────────────────────────────────────────────────────────────

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);
const HAVE_BACKEND_MAP = existsSync(BACKEND_MAP);

function loadBackendN400(): { mapped: string[]; uploadPaths: string[] } {
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const entry = json["N-400"]?.definitions_from ? json[json["N-400"].definitions_from] : json["N-400"];
  const def = entry?.definitions?.["N-400"];
  if (!def) return { mapped: [], uploadPaths: [] };
  return {
    mapped: Object.keys(def.field_to_factkey_map ?? {}),
    uploadPaths: (def.upload_pages ?? []).map((p: { page_path: string }) => p.page_path),
  };
}

describe.skipIf(!HAVE_DESCRIPTOR || !HAVE_BACKEND_MAP)("N-400 descriptor <-> backend value map", () => {
  let driven = new Set<string>();
  let skipped = new Set<string>();
  let uploadSlugs = new Set<string>();
  let mapped: string[] = [];
  let uploadPaths: string[] = [];

  // Loaded in beforeAll, not the describe body: skipIf still RUNS the body, so an
  // eager read would throw at collection and take the whole file down.
  beforeAll(async () => {
    const mod = await import(/* @vite-ignore */ DESCRIPTOR_SPECIFIER);
    const pages = mod.N400_PAGES as Array<{ slug: string; kind: string; fields: Array<{ name: string }> }>;
    driven = new Set(
      pages.flatMap((p) => p.fields.map((f) => f.name.replace(/\{i\}/g, "0").replace(/\{j\}/g, "0"))),
    );
    skipped = new Set(mod.N400_SKIP ?? []);
    uploadSlugs = new Set(pages.filter((p) => p.kind === "upload").map((p) => p.slug));
    ({ mapped, uploadPaths } = loadBackendN400());
  });

  it("drives every field name the backend can emit", () => {
    const missing = mapped.filter((n) => !driven.has(n));
    expect(missing, `backend emits these but the descriptor never fills them: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("never skips a field the backend sends a value for", () => {
    // A name in both places is a contradiction: the backend resolves a value and
    // the descriptor throws it away, so USCIS keeps showing a required error and
    // nothing in the log says why.
    const thrownAway = mapped.filter((n) => skipped.has(n));
    expect(thrownAway, `backend sends these but the descriptor skips them: ${thrownAway.join(", ")}`)
      .toEqual([]);
  });

  it("declares an upload page for every evidence slot the backend routes to", () => {
    const undeclared = uploadPaths.filter((p) => !uploadSlugs.has(p));
    expect(
      undeclared,
      `backend routes documents to these but the descriptor has no upload page: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });
});
