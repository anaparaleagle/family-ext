// I-485 structural descriptor — USCIS "PDF Intake", authored from the live
// capture at test/fixtures/i485-online-field-dump/ (draft 5ab9035c…, 2026-09-15).
// Host: https://my.uscis.gov/pdf-intake/I-485/<draftUuid>/<slug>

import { FormPage, check, cond, located, radio, search, t } from "../runner/types";

/** eligibility-choice: payload code -> the label the autocomplete filters on. */
export const I485_APPLICANT_OPTION_LABELS: Record<string, string> = {
  PrincipalApplicant: "Principal Applicant",
  DerivativeApplicant: "Derivative Applicant",
};

/** eligibility-category-choice: payload code -> option label. */
export const I485_CATEGORY_OPTION_LABELS: Record<string, string> = {
  FAMILY_BASED: "Family-based",
  EMPLOYMENT_BASED: "Employment-based",
};

export const I485_FAMILY_SUBCATEGORIES = [
  "USC_SPOUSE",
  "USC_MINOR_CHILD",
  "USC_PARENT",
  "USC_FIANCE_K1K2",
  "USC_WIDOW",
  "USC_MIL_REL",
  "USC_UNMARRIED_ADULT_SON_DAU",
  "USC_MARRIED_SON_DAU",
  "USC_SIBLING",
  "LPR_SPOUSE",
  "LPR_MINOR_CHILD",
  "LPR_UNMARRIED_ADULT_SON_DAU",
  "VAWA_USC_SPOUSE",
  "VAWA_USC_CHILD",
  "VAWA_USC_PARENT",
];

export const I485_EMPLOYMENT_SUBCATEGORIES = [
  "ALIEN_OF_EXTRAORDINARY_ABILITY",
  "OUTSTANDING_PROFESSOR_OR_RESEARCHER",
  "MULTINATIONAL_EXECUTIVE_OR_MANAGER",
  "MEMBER_OF_THE_PROFESSIONS_HOLDING_AN_ADVANCED_DEGREE_OR_ALIEN_OF_EXCEPTIONAL_ABILITY",
  "A_PROFESSIONAL",
  "A_SKILLED_WORKER",
  "ANY_OTHER_WORKER",
  "AN_ALIEN_APPLYING_FOR_A_NATIONAL_INTEREST_WAIVER",
];

export const I485_SUBCATEGORIES = [
  ...I485_FAMILY_SUBCATEGORIES,
  ...I485_EMPLOYMENT_SUBCATEGORIES,
];

/** The 14 evidence slugs, in walk order. Fixed: they do not vary by category. */
export const I485_EVIDENCE_SLUGS = [
  "485-2-by-2-photograph",
  "government-issued-identity-document-with-photograph",
  "birth-certificate",
  "evidence-of-inspection-and-admission-parole",
  "485-i-797-documentation-of-immigrant-category",
  "lawful-status-since-arrival-in-us",
  "i-693-medical-vaccination-record",
  "affidavit-of-support",
  "certified-police-and-court-records",
  "i-508-form-upload",
  "i-566-form-upload",
  "i-612-form-upload",
  "principal-applicant-form-i-485-or-green-card",
  "additional-evidence",
];

const EVIDENCE_TITLES: Record<string, string> = {
  "485-2-by-2-photograph": "Photographs",
  "government-issued-identity-document-with-photograph":
    "Government-Issued Identity Document with Photograph",
  "birth-certificate": "Birth Certificate",
  "evidence-of-inspection-and-admission-parole":
    "Evidence of Inspection and Admission or Inspection and Parole",
  "485-i-797-documentation-of-immigrant-category": "Documentation of Your Immigrant Category",
  "lawful-status-since-arrival-in-us":
    "Evidence of Continuously Maintaining a Lawful Status Since Arrival in the United States",
  "i-693-medical-vaccination-record":
    "Report of Immigration Medical Examination and Vaccination Record (Form I-693)",
  "affidavit-of-support": "Affidavit of Support Under Section 213A of the INA",
  "certified-police-and-court-records":
    "Certified Police and Court Records of Criminal Charges, Arrests, or Convictions",
  "i-508-form-upload": "I-508, Waiver of Certain Rights, Privileges, Exemptions, and Immunities",
  "i-566-form-upload": "Interagency Record of Request",
  "i-612-form-upload": "Waiver of the Foreign Residence Requirement",
  "principal-applicant-form-i-485-or-green-card":
    "Principal Applicant’s Form I-485, Green Card, or Approved Visa Petition",
  "additional-evidence": "Additional Evidence",
};

/** Captured names deliberately not driven. Empty — every typed input is driven. */
export const I485_SKIP: string[] = [];

export const I485_PAGES: FormPage[] = [
  {
    slug: "/select-eligibility",
    title: "I-485 eligibility selection",
    kind: "form",
    fields: [
      { ...search("eligibility-choice"), valueMap: I485_APPLICANT_OPTION_LABELS },
      cond(
        {
          ...search("eligibility-category-choice"),
          valueMap: I485_CATEGORY_OPTION_LABELS,
        },
        { by: "eligibility-choice" },
      ),
      // One logical key for both branches: the group is named
      // `<PrincipalApplicant|DerivativeApplicant>-subcategories`.
      cond(
        located(radio("select-eligibility.subcategory", I485_SUBCATEGORIES), {
          nameContains: "-subcategories",
        }),
        { by: "eligibility-category-choice" },
      ),
      // Pre-checked "No" on arrival — the only control in the walk with a default.
      cond(
        located(radio("select-eligibility.six-and-six", ["Yes", "No"]), {
          labelContains: "Six and Six",
        }),
        { by: "eligibility-choice" },
      ),
    ],
  },
  {
    slug: "/able-to-pay",
    title: "Are you able to pay the filing fee?",
    kind: "form",
    fields: [
      located(radio("able-to-pay.can-pay-fee", ["Yes", "No"]), {
        labelContains: "Are you able to pay the filing fee?",
      }),
    ],
  },
  {
    // Next never enables here: the page ends in an "Add Client" button that
    // writes a real client record into the attorney's USCIS account. The walk
    // fills the fields and stops; a human presses Add Client.
    slug: "/client-information/0",
    title: "About Your New Client",
    kind: "form",
    fields: [
      t("firstName"),
      t("middleName"),
      t("lastName"),
      t("aNumber"),
      located(check("client-information.a-number-unknown"), {
        labelContains: "does not know or have their A-Number",
      }),
      t("dateOfBirth"),
      t("emailAddress"),
    ],
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
  ...I485_EVIDENCE_SLUGS.map(
    (slug): FormPage => ({
      slug: `/${slug}/I-485/evidence`,
      title: EVIDENCE_TITLES[slug],
      kind: "upload",
      fields: [],
    }),
  ),

  {
    slug: "/review",
    title: "Check your application or petition before you submit",
    kind: "review",
    fields: [],
  },
];
