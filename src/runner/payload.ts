// The shape the popup stores into chrome.storage.local and the content script
// reads. This is the single data contract for the extension — flat field_values
// keyed by Formik name, plus upload-page descriptors.
//
// The extension is data-agnostic: it types what it is given. All "fact -> field"
// knowledge (including the I-130's applicant/beneficiary inversion) lives in the
// backend map and is ALREADY APPLIED by the time a payload lands here.

/** One upload-only page descriptor, straight from the backend `upload_pages`. */
export interface UploadPageDescriptor {
  page_path: string;
  /** "generated_form" (e.g. the I-130A PDF) or "document" (stored evidence). */
  kind: "generated_form" | "document";
  /** For kind=generated_form. */
  form_type?: string;
  /** For kind=document — the controlled doc_type to fetch. */
  doc_type?: string;
  /** Optional party scope for documents (PETITIONER / APPLICANT). */
  party?: string;
  /** Relationship gate, e.g. ["spouse"]. Absent => always applicable. */
  relationship?: string[];
}

/** What `GET /forms/myuscis-preview/` returns, mirrored into storage. */
export interface MyuscisPayload {
  case: string;
  form_type: string;
  field_values: Record<string, string>;
  documents: { upload_pages: UploadPageDescriptor[] };
}

/**
 * Storage keys used by this extension. One loaded payload at a time, whatever
 * the form: `formType` records which form it was resolved for so the content
 * script can warn when the loaded case does not match the form on screen
 * (an I-539 payload cannot fill an I-130 — the Formik names do not overlap).
 */
export const STORAGE_KEYS = {
  fieldValues: "myuscisFieldValues",
  uploadPages: "myuscisUploadPages",
  caseId: "myuscisCaseId",
  formType: "myuscisFormType",
  accessToken: "accessToken",
  apiBaseUrl: "apiBaseUrl",
  loadedAt: "myuscisLoadedAt",
} as const;
