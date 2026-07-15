// Resolve upload-page descriptors to real files and attach them.
//
// The backend `myuscis-preview` endpoint returns upload_pages as METADATA only
// (which doc_type / generated form goes on which page) — it does not resolve to
// bytes. So this module is the seam that turns a descriptor into a downloadable
// file, then hands the bytes to the engine doc-uploader.
//
//   kind: "document"        -> GET /documents/?case=<id>, pick the row whose
//                              doc_type (and party, if scoped) matches, fetch
//                              its file_url through the background proxy.
//   kind: "generated_form"  -> the generated form's PDF (e.g. I-130A). Fetched
//                              from GET /forms/generated/?case=<id> (the staff
//                              GeneratedFormViewSet); the latest row whose
//                              form_type matches carries a file_url to the
//                              filled PDF, downloaded through the background
//                              proxy with the bearer token.
//
// Form-agnostic: it acts on whatever upload_pages the backend sent for whatever
// form was loaded. Both file URLs come from the same backend contract:
//   - documents:        DocumentSerializer.file_url        (GET /documents/?case=)
//   - generated forms:  GeneratedFormSerializer.file_url   (GET /forms/generated/?case=)
// Both are absolute media URLs the download-proxy fetches with the firm token.
// The attach itself (DataTransfer into the dropzone) is exercised live via
// agent-browser; the URL-resolution shape is the verified backend contract.

import { attachFiles } from "../engine/doc-uploader";
import { dbg } from "../engine/logger";
import { UploadPageDescriptor } from "./payload";

interface DocRow {
  id: string;
  doc_type: string;
  party?: string | null;
  file_url?: string | null;
  filename?: string | null;
}

/** A row from GET /forms/generated/?case=<id> (GeneratedFormSerializer). */
interface GeneratedFormRow {
  id: string;
  form_type: string;
  version?: number;
  status?: string;
  file_url?: string | null;
}

interface ResolveContext {
  apiBaseUrl: string;
  accessToken: string;
  caseId: string;
}

/**
 * The message shown whenever the family backend rejects our bearer token. The
 * popup mirrors the Firebase token into storage on "Load case"; once it ages
 * out, every doc fetch 401s and the only fix is to reopen the popup.
 */
export const SESSION_EXPIRED_MESSAGE =
  "Session expired — reopen the popup and Load case.";

/** Fetch the family-backend documents list for a case (firm-scoped, STAFF). */
async function fetchDocuments(ctx: ResolveContext): Promise<DocRow[]> {
  const res = await fetch(`${ctx.apiBaseUrl}/documents/?case=${encodeURIComponent(ctx.caseId)}`, {
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  });
  if (!res.ok) {
    dbg(
      res.status === 401
        ? `doc-flow: documents list 401 — ${SESSION_EXPIRED_MESSAGE}`
        : `doc-flow: documents list failed (${res.status})`,
    );
    return [];
  }
  const data = await res.json();
  const rows = (data.results ?? data) as DocRow[];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Fetch the case's generated forms and return the latest (highest-version) row
 * for the requested form_type, or null. Real endpoint:
 *   GET /api/v1/forms/generated/?case=<id>&form_type=<ft>
 *   (GeneratedFormViewSet, IsStaff + IsSameFirm; serializer exposes file_url ->
 *   the filled PDF, ordered ("form_type", "-version")).
 *
 * The `form_type` filter is REQUIRED here, not a convenience: the endpoint is
 * paginated (25/page) and a case with lots of generated history (PACKET /
 * I-864A versions — PA-2049 has 184 rows) pushes the I-130A rows past page 1,
 * so an unfiltered first-page read silently finds nothing. Filtering server-side
 * collapses the result to just this form's versions (well under one page). We
 * still pick max version defensively in case ordering drifts.
 */
async function fetchGeneratedForm(
  ctx: ResolveContext,
  formType: string,
): Promise<GeneratedFormRow | null> {
  const url =
    `${ctx.apiBaseUrl}/forms/generated/` +
    `?case=${encodeURIComponent(ctx.caseId)}&form_type=${encodeURIComponent(formType)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  });
  if (!res.ok) {
    dbg(
      res.status === 401
        ? `doc-flow: generated-forms list 401 — ${SESSION_EXPIRED_MESSAGE}`
        : `doc-flow: generated-forms list failed (${res.status})`,
    );
    return null;
  }
  const data = await res.json();
  const rows = (data.results ?? data) as GeneratedFormRow[];
  if (!Array.isArray(rows)) return null;
  const matching = rows.filter((r) => r.form_type === formType && r.file_url);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => ((r.version ?? 0) > (best.version ?? 0) ? r : best));
}

/** Download a file_url through the background proxy and wrap it as a File. */
async function downloadAsFile(url: string, accessToken: string, filename: string): Promise<File | null> {
  const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_FILE", url, accessToken });
  if (!response?.success) {
    // The proxy reports a failed fetch as "HTTP <status>"; a 401 there means the
    // mirrored token aged out, which is worth naming rather than showing raw.
    const error = String(response?.error ?? "unknown error");
    dbg(
      /\b401\b/.test(error)
        ? `doc-flow: download 401 for ${url} — ${SESSION_EXPIRED_MESSAGE}`
        : `doc-flow: download failed for ${url}: ${error}`,
    );
    return null;
  }
  const blob = new Blob([new Uint8Array(response.data)], { type: response.contentType });
  return new File([blob], filename, { type: response.contentType });
}

/** Resolve one upload-page descriptor to the File(s) it needs. */
async function resolveFilesFor(
  descriptor: UploadPageDescriptor,
  docs: DocRow[],
  ctx: ResolveContext,
): Promise<File[]> {
  if (descriptor.kind === "document") {
    const wanted = (descriptor.doc_type || "").toLowerCase();
    const wantParty = descriptor.party?.toUpperCase();
    const matches = docs.filter((d) => {
      if ((d.doc_type || "").toLowerCase() !== wanted) return false;
      if (wantParty && (d.party || "").toUpperCase() !== wantParty) return false;
      return !!d.file_url;
    });
    const files: File[] = [];
    for (const m of matches) {
      const name = m.filename || `${m.doc_type}.pdf`;
      const file = await downloadAsFile(m.file_url as string, ctx.accessToken, name);
      if (file) files.push(file);
    }
    return files;
  }

  if (descriptor.kind === "generated_form") {
    // e.g. the I-130A supplement PDF. Fetch the latest generated row for this
    // form_type from GET /forms/generated/?case=<id> and download its file_url.
    // The backend only fills the PDF on demand via the staff `generate` action;
    // if no row exists yet, the firm must generate it in ParaLeagle first (we
    // surface that as a warning rather than silently attaching nothing).
    const formType = descriptor.form_type;
    if (!formType) {
      dbg("doc-flow: generated_form descriptor missing form_type");
      return [];
    }
    const row = await fetchGeneratedForm(ctx, formType);
    if (!row || !row.file_url) {
      dbg(
        `doc-flow: no generated ${formType} on file for this case — generate it in ` +
          `ParaLeagle before attaching.`,
      );
      return [];
    }
    const file = await downloadAsFile(row.file_url, ctx.accessToken, `${formType}.pdf`);
    return file ? [file] : [];
  }

  return [];
}

/**
 * For the current upload page, resolve its descriptor's files and attach them.
 * `descriptor` is the matching entry from the stored upload_pages list.
 */
export async function fillUploadPage(
  descriptor: UploadPageDescriptor,
  ctx: ResolveContext,
): Promise<{ attached: number; warnings: string[] }> {
  const docs = descriptor.kind === "document" ? await fetchDocuments(ctx) : [];
  const files = await resolveFilesFor(descriptor, docs, ctx);
  if (files.length === 0) {
    return { attached: 0, warnings: [`No file resolved for ${descriptor.page_path}.`] };
  }
  return attachFiles(files);
}

/** Match a stored upload-page descriptor to the current URL path. */
export function descriptorForPath(
  path: string,
  uploadPages: UploadPageDescriptor[],
): UploadPageDescriptor | null {
  const p = path.replace(/\/$/, "");
  return uploadPages.find((d) => p.endsWith(d.page_path.replace(/\/$/, ""))) ?? null;
}
