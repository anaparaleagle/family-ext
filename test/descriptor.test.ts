import { describe, it, expect } from "vitest";
import { I130_PAGES, descriptorFieldNames } from "../src/i130/form-descriptor";
import { pageForUrl, pageForHeading } from "../src/runner/section-detector";
import { descriptorForPath } from "../src/runner/doc-flow";
import type { UploadPageDescriptor } from "../src/runner/payload";
import type { FormPage } from "../src/runner/types";

const BASE = "https://my.uscis.gov/forms/petition-for-a-relative/12993840";

const stub = (slug: string): FormPage => ({ slug, title: slug, kind: "form", fields: [] });

describe("section-detector", () => {
  it("detects a page by URL slug", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/about-you/your-name`);
    expect(p?.slug).toBe("/about-you/your-name");
  });

  it("prefers the longer nested slug over its prefix", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/your-family/your-parents/your-parents`);
    expect(p?.slug).toBe("/your-family/your-parents/your-parents");
  });

  it("tolerates a trailing slash", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/about-you/describe-yourself/`);
    expect(p?.slug).toBe("/about-you/describe-yourself");
  });

  it("falls back to heading match", () => {
    const p = pageForHeading(I130_PAGES, "Beneficiary relationship");
    expect(p?.slug).toBe("/your-beneficiary/beneficiary-relationship");
  });

  it("returns null for an unknown URL", () => {
    expect(pageForUrl(I130_PAGES, "https://my.uscis.gov/account/dashboard")).toBeNull();
  });

  // ── The `-page-1` alias ───────────────────────────────────────────────────
  // myUSCIS nests a page under itself once it gains a sibling: the bare route
  // starts being served as a `-page-1` CHILD, beside the `-page-2` that appeared.
  // Matching is by path suffix, so the bare slug then matches nothing and the
  // walk clicks past a page it can fill. Handled as a rule, not per slug: any
  // page can move, and a draft created before the split still serves the bare
  // route, so both forms have to resolve.

  it("detects a page from the -page-1 child route it is nested under", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/about-you/your-name/your-name-page-1`);
    expect(p?.slug).toBe("/about-you/your-name");
  });

  it("tolerates a trailing slash on the -page-1 route", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/about-you/your-name/your-name-page-1/`);
    expect(p?.slug).toBe("/about-you/your-name");
  });

  it("keeps an explicitly declared -page-2 slug matching its own URL", () => {
    const p = pageForUrl(I130_PAGES, `${BASE}/your-family/your-parents/your-parents-page-2`);
    expect(p?.slug).toBe("/your-family/your-parents/your-parents-page-2");
  });

  it("lets an exact match on ANY page beat a -page-1 alias on a longer slug", () => {
    // Two full passes, exact first — not one pass that considers both forms per
    // page. A slug declared as it is served must win even when some other page's
    // alias also fits and that page's slug sorts first by length.
    const pages = [stub("/moral-character/good-moral-character"), stub("/good-moral-character-page-1")];
    const p = pageForUrl(pages, `${BASE}/moral-character/good-moral-character/good-moral-character-page-1`);
    expect(p?.slug).toBe("/good-moral-character-page-1");
  });

  it("does not let a bare page's alias swallow its declared -page-2 sibling", () => {
    const pages = [
      stub("/your-family/your-parents/your-parents"),
      stub("/your-family/your-parents/your-parents-page-2"),
    ];
    const p = pageForUrl(pages, `${BASE}/your-family/your-parents/your-parents-page-2`);
    expect(p?.slug).toBe("/your-family/your-parents/your-parents-page-2");
  });

  it("matches only the nested alias, not any URL ending in -page-1", () => {
    // Strict, not fuzzy: the alias is `<slug>/<last segment>-page-1` and nothing
    // else. A sibling route that merely ends in -page-1 stays unknown.
    expect(pageForUrl(I130_PAGES, `${BASE}/about-you/your-name-page-1`)).toBeNull();
    expect(pageForUrl(I130_PAGES, `${BASE}/about-you/your-name/other-page-1`)).toBeNull();
    expect(pageForUrl(I130_PAGES, `${BASE}/about-you/your-name/your-name-page-3`)).toBeNull();
  });
});

describe("descriptor coverage", () => {
  it("marks the I-130A + evidence pages as upload-only", () => {
    const uploadSlugs = I130_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug);
    expect(uploadSlugs).toContain("/evidences/i130a-supplimental-information-for-spouse-beneficiary");
    expect(uploadSlugs).toContain("/evidences/proof-of-marriage");
    expect(uploadSlugs).toContain("/evidences/photo-of-you");
    expect(uploadSlugs).toContain("/evidences/photo-of-spouse");
    // Upload pages carry no fillable fields.
    for (const p of I130_PAGES.filter((x) => x.kind === "upload")) {
      expect(p.fields.length).toBe(0);
    }
  });

  it("marks the review page and never lets it carry fields", () => {
    const review = I130_PAGES.find((p) => p.kind === "review");
    expect(review?.slug).toBe("/review-and-submit/review-your-petition");
    expect(review?.fields.length).toBe(0);
  });

  it("flags every repeater section with an Add button + name prefix", () => {
    const repeaters = I130_PAGES.filter((p) => p.repeater);
    const prefixes = repeaters.map((p) => p.repeater!.namePrefix);
    expect(prefixes).toContain("applicant.yourAddressHistory");
    expect(prefixes).toContain("applicant.employmentHistory");
    expect(prefixes).toContain("otherInformation.otherPetitions");
    for (const p of repeaters) {
      expect(p.repeater!.addButtonText.length).toBeGreaterThan(0);
      // Repeater fields use the {i} token.
      expect(p.fields.some((f) => f.name.includes("{i}"))).toBe(true);
    }
  });

  it("drives a meaningful number of distinct fields", () => {
    // Sanity floor — the descriptor should cover the bulk of the dump's
    // fillable fields (exact count asserted against the backend payload below).
    expect(descriptorFieldNames().length).toBeGreaterThan(80);
  });
});

describe("upload descriptor matching", () => {
  const uploadPages: UploadPageDescriptor[] = [
    { page_path: "/evidences/proof-of-marriage", kind: "document", doc_type: "marriage_certificate" },
    {
      page_path: "/evidences/i130a-supplimental-information-for-spouse-beneficiary",
      kind: "generated_form",
      form_type: "I-130A",
    },
  ];

  it("matches a URL path to its upload descriptor", () => {
    const d = descriptorForPath(`${BASE}/evidences/proof-of-marriage`, uploadPages);
    expect(d?.doc_type).toBe("marriage_certificate");
  });

  it("returns null for a non-upload path", () => {
    expect(descriptorForPath(`${BASE}/about-you/your-name`, uploadPages)).toBeNull();
  });
});
