// ===========================================================================
// I-765 STRUCTURAL DESCRIPTOR — USCIS "PDF Intake" (BETA), not a guided form.
//
// Authored from the live capture vendored at
// test/fixtures/i765-online-field-dump/ (draft d26a43cc…, 2026-09-11). Every
// slug, name, option label and question string below was read off the running
// pages; nothing is inferred. test/i765-coverage.test.ts holds this file to
// that capture.
//
// Form: I-765, Application for Employment Authorization — PDF Intake flavor.
// Host: https://my.uscis.gov/pdf-intake/I-765/<draftUuid>/<slug>
//
// WHAT THE CAPTURE ESTABLISHED (facts, not assumptions):
//  - PDF Intake is a wrapper around a PDF UPLOAD, not field-by-field filling:
//    3 typed pages (7 inputs total), 8 upload pages, 1 review page. The real
//    work here is the doc-flow attaching the backend's already-filled I-765 and
//    G-28 PDFs plus the evidence, not typing.
//  - It is NOT Formik. Field names are generic MUI defaults, and they COLLIDE
//    across pages: `controlled-radio-buttons-group` names the I-485-fee gate on
//    /select-eligibility AND the can-you-pay radio on /able-to-pay — different
//    questions. Those two radios therefore carry SYNTHETIC names below (the
//    exact keys the backend map emits) and are anchored to their QUESTION TEXT
//    via locate.labelContains; the engine resolves the group from the smallest
//    container holding that text (value-setter locateRadios).
//  - PDF Intake serves only seven eligibility categories — (a)(12), (c)(8),
//    (c)(9), (c)(11) x2, (c)(19). NO (c)(3) OPT, NO (c)(26) H-4. So this flow
//    covers the family C9 pending-I-485 EAD (IR-1/IR-2/IR-5) and cannot serve
//    the OPT/H-4 I-765 case types.
//  - The evidence slugs carry an `/I-765/evidence` SUFFIX (…/employment/I-765/
//    evidence). The upload slugs below are byte-exact contract strings: the
//    backend's upload_pages page_path values must equal them (doc-flow matches
//    page.slug against page_path as a path tail).
//  - Buttons are data-testid next-btn / back-btn on every page; the upload
//    control is "Choose or drop file here to upload".
//  - /review keeps Next DISABLED until the application is complete — successful
//    uploads ENABLE it. kind:"review" stops the walk, and fill-chain's terminal
//    guard also covers /pdf-intake/…/review in case the slug ever drifts.
//
// KNOWN GAPS / DELIBERATE CHOICES (honest — do not paper over):
//  1. The Form I-912 fee-waiver upload slot is INLINE on /able-to-pay, revealed
//     by answering No to the fee question. It is not a page of its own, and the
//     walk only attaches documents on kind:"upload" pages — so if the backend
//     ever routes an I-912 to "/able-to-pay" it will NOT be attached; the firm
//     uploads it by hand. The backend does not normally send it (C9 with the
//     post-04/01/2024 fee gate answered Yes is fee-exempt, $0.00 on review).
//  2. /client-information/0 is an INDEXED slug (possibly multi-client for a
//     legal rep). Only index 0 was captured; a second client page would walk
//     past as "page not in descriptor" — visibly, in the log.
//  3. What /form-i-485/I-765/evidence shows when the I-485 has no receipt yet
//     (true concurrent filing) was not captured; nor were the Renewal/
//     Replacement reveals. Recapture before relying on either.
// ===========================================================================

import { FormPage, cond, located, radio, search, t } from "../runner/types";

/**
 * Committed autocomplete CODE -> the full option label the widget filters on.
 *
 * The backend emits the code the input commits ("C9" — read live off the
 * input's value). But the MUI autocomplete filters its list on the option
 * LABEL, so typing the raw code renders zero options and the fill dies on the
 * very first field. valueMap makes the descriptor own that translation: the
 * payload key convention stays the stable code, the engine types the label.
 *
 * Only the codes OBSERVED live are mapped (C9 on the primary walk, A12 on the
 * branch capture). The other categories' codes were never read off the input,
 * and guessing "(c)(8)" -> "C8" here would type an unverified string into a
 * federal filing. Add them from a capture, not from pattern-matching.
 */
export const I765_ELIGIBILITY_OPTION_LABELS: Record<string, string> = {
  C9: "(c)(9) Certain Family and Employment Based Adjustment Applicant Under Section 245",
  A12: "(a)(12) Temporary Protected Status Granted",
};

/**
 * Captured field names this descriptor deliberately does NOT drive. Empty: all
 * seven typed inputs on the three form pages are driven (the two colliding
 * radios by synthetic name + question anchor). The coverage test asserts
 * nothing falls between "driven" and "skipped".
 */
export const I765_SKIP: string[] = [];

export const I765_PAGES: FormPage[] = [
  // ── Typed pages ──────────────────────────────────────────────────────────
  {
    slug: "/select-eligibility",
    title: "What is your eligibility category?",
    kind: "form",
    fields: [
      // Autocomplete: type the label, click the option; the input commits the
      // code. Both radios below only render once a category is chosen, so they
      // are declared as reveals of this field — the chain then drives this
      // first and waits for the radios instead of racing them.
      { ...search("eligibility-choice"), valueMap: I765_ELIGIBILITY_OPTION_LABELS },
      cond(radio("reason-for-filing-radio-group", ["Initial", "Replacement", "Renewal"]), {
        by: "eligibility-choice",
      }),
      // The C9-only fee gate — Yes means the I-485 was filed with a fee on or
      // after 04/01/2024, so this I-765 is fee-exempt ($0.00 on review). Its
      // DOM name is the colliding `controlled-radio-buttons-group`; the name
      // below is the backend payload key, the anchor is the question text.
      cond(
        located(radio("select-eligibility.i485-fee-post-20240401", ["Yes", "No"]), {
          labelContains: "You filed your I-485 with a fee on or after 04/01/2024",
        }),
        { by: "eligibility-choice", is: "C9" },
      ),
    ],
  },
  {
    slug: "/client-information/0",
    title: "Information About Your Client",
    kind: "form",
    // The CLIENT's legal name (this is the legal-rep flavor of pdf-intake).
    // Real ids/names, no collision — plain text fields.
    fields: [t("firstName"), t("middleName"), t("lastName")],
  },
  {
    slug: "/able-to-pay",
    title: "Are you able to pay the filing fee?",
    kind: "form",
    fields: [
      // Second instance of the colliding generic name — same treatment as the
      // fee gate: synthetic backend key + question anchor. Answering No reveals
      // the INLINE Form I-912 upload slot on this same page (see gap 1 in the
      // header — that slot is not automated).
      located(radio("able-to-pay.can-pay-fee", ["Yes", "No"]), {
        labelContains: "Are you able to pay the filing fee?",
      }),
    ],
  },

  // ── Upload pages ─────────────────────────────────────────────────────────
  // Slugs are the backend page_path contract — byte-exact, `/I-765/evidence`
  // suffix included. All accept jpg/tiff/pdf except where noted.
  {
    slug: "/form",
    title: "PDF Form Upload",
    kind: "upload",
    // The backend's generated, filled (and signed) I-765 PDF — one file, ALL
    // pages in order, even blank ones (pdf only).
    fields: [],
  },
  {
    slug: "/form-g28",
    title: "G-28 PDF Form Upload",
    kind: "upload",
    // The SIGNED G-28 (signature must be handwritten per the on-page text —
    // never the unsigned draft). pdf only.
    fields: [],
  },
  {
    slug: "/applicant-photo/I-765/evidence",
    title: '2" x 2" Photo of you',
    kind: "upload",
    fields: [], // jpeg/png only
  },
  {
    slug: "/form-i-94-passport/I-765/evidence",
    title: "Form I-94, Arrival And Departure Record Or Passport",
    kind: "upload",
    fields: [],
  },
  {
    slug: "/employment/I-765/evidence",
    title: "Employment Authorization Document Or Government ID",
    kind: "upload",
    fields: [], // prior EAD front/back, else a government photo ID
  },
  {
    slug: "/form-i-485/I-765/evidence",
    title: "I-485, Application To Register Permanent Residence Or Adjust Status",
    kind: "upload",
    fields: [], // the I-485 receipt notice / pendency evidence (C9's basis)
  },
  {
    slug: "/form-i-797c/I-765/evidence",
    title: "I-797C Notice of Action",
    kind: "upload",
    fields: [],
  },
  {
    slug: "/additional-evidence/I-765/evidence",
    title: "Additional Evidence",
    kind: "upload",
    fields: [], // catch-all, max 5 docs, jpg/tiff/png/pdf; translations required
  },

  // ── Review ───────────────────────────────────────────────────────────────
  {
    // Next (testid next-btn) is DISABLED here until the application is complete
    // and SELF-ENABLES when the uploads land — so this page must stop the walk
    // (kind "review" does; onTerminalPath's pdf-intake branch is the backstop).
    slug: "/review",
    title: "Check your application or petition before you submit",
    kind: "review",
    fields: [],
  },
];
