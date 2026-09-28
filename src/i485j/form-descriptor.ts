// I-485 Supplement J, filed standalone on USCIS "PDF Intake".
// Host: https://my.uscis.gov/pdf-intake/I-485J/<draftUuid>/<slug>

import { I485_PAGES } from "../i485/form-descriptor";
import { FormPage, search } from "../runner/types";

// Eligibility and client-information captured live; the upload, I-817 and
// review slugs are still inferred from the I-485. Mirrored by
// test/fixtures/i485j-inferred.ts.
export const I485J_HOST_PATH = "/pdf-intake/I-485J/";

export const I485J_SLUGS = {
  eligibility: "/select-eligibility",
  clientInformation: "/client-information/0",
  form: "/form",
  g28: "/form-g28",
  i817: "/i-817-form-upload/I-485J/evidence",
  additionalEvidence: "/additional-evidence/I-485J/evidence",
  review: "/review",
} as const;

export const I485J_ELIGIBILITY_FIELD = "eligibility-choice";

/** eligibility-choice: payload code -> the label the select shows. */
export const I485J_ELIGIBILITY_LABELS: Record<string, string> = {
  ConfirmationOfValidJobOffer: "Confirmation of valid job offer",
  RequestForJobPortability: "Request for job portability",
};

export const I485J_PAGES: FormPage[] = [
  {
    slug: I485J_SLUGS.eligibility,
    title: "I-485J eligibility selection",
    kind: "form",
    fields: [
      {
        ...search(I485J_ELIGIBILITY_FIELD),
        valueMap: I485J_ELIGIBILITY_LABELS,
        strictValueMap: true,
      },
    ],
  },
  {
    // Only asked when the client is not already in the attorney's list.
    slug: I485J_SLUGS.clientInformation,
    title: "About Your New Client",
    kind: "form",
    advanceButtonText: "Add Client",
    fields: I485_PAGES.find((p) => p.slug === "/client-information/0")!.fields,
  },
  { slug: I485J_SLUGS.form, title: "PDF Form Upload", kind: "upload", fields: [] },
  { slug: I485J_SLUGS.g28, title: "G-28 PDF Form Upload", kind: "upload", fields: [] },
  { slug: I485J_SLUGS.i817, title: "Form I-817", kind: "skip", fields: [] },
  {
    // Not a catch-all: the Supplement J and the G-28 must never land here.
    slug: I485J_SLUGS.additionalEvidence,
    title: "Additional Evidence",
    kind: "upload",
    fields: [],
  },
  {
    slug: I485J_SLUGS.review,
    title: "Check your application or petition before you submit",
    kind: "review",
    fields: [],
  },
];
