// The standalone I-485 Supplement J on pdf-intake. The host path, eligibility and
// client-information pages are captured live; the upload, I-817 and review slugs
// are still inferred from the I-485 capture (test/fixtures/i485-online-field-dump/).

export const I485J_HOST_PATH = "/pdf-intake/I-485J/";

export const I485J_BASE =
  "https://my.uscis.gov/pdf-intake/I-485J/00000000-0000-4000-8000-000000000000";

export const I485J_SLUGS = {
  eligibility: "/select-eligibility",
  clientInformation: "/client-information/0",
  form: "/form",
  g28: "/form-g28",
  i817: "/i-817-form-upload/I-485J/evidence",
  additionalEvidence: "/additional-evidence/I-485J/evidence",
  review: "/review",
} as const;

/** eligibility-choice: the portal's option code -> the label it shows. */
export const I485J_ELIGIBILITY_LABELS: Record<string, string> = {
  ConfirmationOfValidJobOffer: "Confirmation of valid job offer",
  RequestForJobPortability: "Request for job portability",
};

export const I485J_CASE_TYPES = ["EB-1B-1C", "EB-1B", "EB-1C", "EB-2-PERM", "EB-3"];

export const EB_CASE_TYPES_WITHOUT_I485J = ["EB-1A", "EB-2-NIW", "EB-4", "EB-5"];

/** Letters, digits, space, period, hyphen, underscore and parentheses. */
export const USCIS_FILENAME = /^[A-Za-z0-9 ._()-]+$/;

const evidence = (order: number, doc_type: string) => ({
  page_path: I485J_SLUGS.additionalEvidence,
  kind: "document" as const,
  doc_type,
  section: "evidence",
  order,
  members: [0],
});

/** The Additional Evidence entries, in the order the backend sends them. */
export const I485J_EVIDENCE_UPLOADS = [
  {
    page_path: I485J_SLUGS.additionalEvidence,
    kind: "generated_form" as const,
    form_type: "COVER_LETTER_I-485J",
    section: "evidence",
    order: 1,
    members: [0],
  },
  evidence(2, "i485_receipt_notice"),
  evidence(3, "i140"),
  evidence(4, "offer_letter"),
  evidence(5, "perm_labor_certification"),
  evidence(6, "i485_transfer_or_prior_supj_receipt"),
];

/** A backend-shaped upload_pages list for an I-485J: the two form uploads, then the evidence. */
export const I485J_UPLOAD_PAGES = [
  { page_path: I485J_SLUGS.form, kind: "document" as const, doc_type: "i485j_signed", section: "upload_pdf", order: 1, members: [0] },
  { page_path: I485J_SLUGS.form, kind: "generated_form" as const, form_type: "I-485J", section: "upload_pdf", order: 1, members: [0] },
  { page_path: I485J_SLUGS.g28, kind: "document" as const, doc_type: "g28_applicant_signed", section: "upload_pdf", order: 2, members: [0] },
  { page_path: I485J_SLUGS.g28, kind: "generated_form" as const, form_type: "G-28-BEN", section: "upload_pdf", order: 2, members: [0] },
  ...I485J_EVIDENCE_UPLOADS,
];
