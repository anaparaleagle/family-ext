// I-131 structural descriptor — USCIS "PDF Intake", authored from the live
// capture at test/fixtures/i131-online-field-dump/ (draft 555dda9e…, 2026-09-15).
// Host: https://my.uscis.gov/pdf-intake/I-131/<draftUuid>/<slug>
//
// Our cases file ADVANCE_PAROLE + PENDING_485 — advance parole on a pending
// adjustment — which is the walk that was captured live.

import { FormPage, cond, located, radio, search, t } from "../runner/types";

/** eligibility-choice: payload code -> the label the Select renders. */
export const I131_CATEGORY_OPTION_LABELS: Record<string, string> = {
  REENTRY_PERMIT: "Reentry Permit",
  REFUGEE_STATUS: "Refugee Travel Document",
  TPS_BENEFICIARY:
    "Travel Authorization Document (for Temporary Protected Status (TPS) beneficiaries who are inside the United States)",
  ADVANCE_PAROLE:
    "Advance Parole Document (for aliens who are inside the United States) and Advance Permission to Travel for Commonwealth of Northern Mariana Islands (CNMI) Long-Term Residents",
  INITIAL_PAROLE: "Initial Parole Document (for aliens who are currently outside the United States)",
  PAROLE_IN_PLACE:
    "Initial Request for Arrival/Departure Record for Parole In Place (for aliens who are inside the United States)",
  REPAROLE_NEW_PERIOD_OF_PAROLE:
    "Arrival/Departure Records for Re-parole for Aliens Who Are Requesting a New Period of Parole (from inside the United States)",
};

/** The subcategory codes under ADVANCE_PAROLE — the only category we file. */
export const I131_ADVANCE_PAROLE_SUBCATEGORIES = [
  "PENDING_485",
  "PENDING_INITIAL_821",
  "DEFERRED_ENFORCED_DEPARTURE",
  "APPROVED_821D",
  "APPROVED_918",
];

/** Evidence slots every category renders. */
export const I131_UNIVERSAL_EVIDENCE_SLUGS = [
  "applicant-photo",
  "photo-id",
  "additional-evidence",
];

/** Evidence slots ADVANCE_PAROLE adds on top of the universal three. */
export const I131_ADVANCE_PAROLE_EVIDENCE_SLUGS = ["form-i-797", "form-i-797c"];

/** Captured names deliberately not driven. Empty: both typed controls are driven. */
export const I131_SKIP: string[] = [];

export const I131_PAGES: FormPage[] = [
  {
    slug: "/select-eligibility",
    title: "What is your eligibility category?",
    kind: "form",
    fields: [
      { ...search("eligibility-choice"), valueMap: I131_CATEGORY_OPTION_LABELS },
      // The group is named from the category: `<CATEGORY>-subcategories`. Three
      // of the seven categories render no subcategory radios at all, so this is
      // a conditional reveal as well as a fragment match.
      cond(
        located(radio("select-eligibility.subcategory", I131_ADVANCE_PAROLE_SUBCATEGORIES), {
          nameContains: "-subcategories",
        }),
        { by: "eligibility-choice" },
      ),
    ],
  },
  {
    // Captured in its HAS-CLIENT shape: three names, Next already enabled, no
    // Add Client gate. A draft with no client attached shows four more fields
    // behind that gate — see the I-485 descriptor, which captured that state.
    slug: "/client-information/0",
    title: "Information About Your Client",
    kind: "form",
    fields: [t("firstName"), t("middleName"), t("lastName")],
  },

  {
    slug: "/form",
    title: "PDF Form Upload",
    kind: "upload",
    fields: [],
  },
  {
    slug: "/form-g28",
    title: "G-28 PDF Form Upload",
    kind: "upload",
    fields: [],
  },
  {
    slug: "/applicant-photo/I-131/evidence",
    title: '2" x 2" Photo of you',
    kind: "upload",
    fields: [], // jpeg/png only, one file
  },
  {
    slug: "/photo-id/I-131/evidence",
    title: "Photo Identity Document",
    kind: "upload",
    fields: [], // jpeg/png only — NO pdf, and a passport scan often is one
  },
  // The two I-797 slots belong to ADVANCE_PAROLE (and TPS renders its own
  // variant). Unlike the I-485, whose 14 slots are fixed, the I-131's evidence
  // list is per category — so these are conditional, and a category without them
  // simply walks past.
  {
    slug: "/form-i-797/I-131/evidence",
    title: "I-797 Notice of Action",
    kind: "upload",
    fields: [],
    conditional: true,
  },
  {
    slug: "/form-i-797c/I-131/evidence",
    title: "I-797C Notice of Action",
    kind: "upload",
    fields: [],
    conditional: true,
  },
  {
    slug: "/additional-evidence/I-131/evidence",
    title: "Additional Evidence",
    kind: "upload",
    fields: [],
  },

  {
    slug: "/review",
    title: "Check your application or petition before you submit",
    kind: "review",
    fields: [],
  },
];
