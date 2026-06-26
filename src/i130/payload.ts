// The shape the popup stores into chrome.storage.local and the content script
// reads. This is the single data contract for the extension — flat field_values
// keyed by Formik name, plus upload-page descriptors. The applicant/beneficiary
// inversion is ALREADY APPLIED backend-side; nothing here interprets the data.

/** One upload-only page descriptor, straight from the backend `upload_pages`. */
export interface UploadPageDescriptor {
  page_path: string;
  /** "generated_form" (e.g. I-130A PDF) or "document" (stored evidence). */
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
export interface I130Payload {
  case: string;
  form_type: string;
  field_values: Record<string, string>;
  documents: { upload_pages: UploadPageDescriptor[] };
}

/** Storage keys used by this extension. */
export const STORAGE_KEYS = {
  fieldValues: "i130FieldValues",
  uploadPages: "i130UploadPages",
  caseId: "i130CaseId",
  accessToken: "accessToken",
  apiBaseUrl: "apiBaseUrl",
  loadedAt: "i130LoadedAt",
} as const;
