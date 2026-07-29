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
// On prod both are PRESIGNED S3 URLs (config/settings/s3.py), not paths on the
// API host — the download-proxy allowlists S3 and deliberately withholds the
// bearer token there, since a presigned URL is already self-authenticating.
//
// EVERY request in here goes through the service worker (engine/download-proxy)
// via runner/api-transport. A content script runs at my.uscis.gov's origin and
// MV3 does not exempt it from CORS, so a direct `fetch` to the family API has
// its preflight refused and never sends the real request. That is what broke doc
// upload entirely: the rejected fetch was uncaught and killed the walk silently.

import { attachFiles } from "../engine/doc-uploader";
import { dbg } from "../engine/logger";
import { apiGet } from "./api-transport";
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

/**
 * Turn a failed ApiResult into one user-facing sentence. A 401 means the token
 * the popup mirrored into storage aged out, which has a specific remedy; a
 * transport failure (no status) means the request never reached the server.
 */
function describeApiFailure(what: string, status: number | undefined, error: string | undefined): string {
  if (status === 401 || status === 403) return `${what}: ${SESSION_EXPIRED_MESSAGE}`;
  if (status !== undefined) return `${what} failed (HTTP ${status}).`;
  return `${what} could not reach the ParaLeagle API — ${error ?? "unknown error"}.`;
}

/** What a list read produced: rows, or the reason it produced none. */
interface ListResult<T> {
  rows: T[];
  error?: string;
}

/** Fetch the family-backend documents list for a case (firm-scoped, STAFF). */
async function fetchDocuments(ctx: ResolveContext): Promise<ListResult<DocRow>> {
  const res = await apiGet<{ results?: DocRow[] } | DocRow[]>(
    `/documents/?case=${encodeURIComponent(ctx.caseId)}`,
    ctx,
  );
  if (!res.ok) {
    const message = describeApiFailure("Documents list", res.status, res.error);
    dbg(`doc-flow: ${message}`);
    return { rows: [], error: message };
  }
  const data = res.data as { results?: DocRow[] } | DocRow[] | null;
  const rows = (Array.isArray(data) ? data : data?.results) ?? [];
  return { rows: Array.isArray(rows) ? rows : [] };
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
): Promise<{ row: GeneratedFormRow | null; error?: string }> {
  const path =
    `/forms/generated/` +
    `?case=${encodeURIComponent(ctx.caseId)}&form_type=${encodeURIComponent(formType)}`;
  const res = await apiGet<{ results?: GeneratedFormRow[] } | GeneratedFormRow[]>(path, ctx);
  if (!res.ok) {
    const message = describeApiFailure("Generated-forms list", res.status, res.error);
    dbg(`doc-flow: ${message}`);
    return { row: null, error: message };
  }
  const data = res.data as { results?: GeneratedFormRow[] } | GeneratedFormRow[] | null;
  const rows = (Array.isArray(data) ? data : data?.results) ?? [];
  if (!Array.isArray(rows)) return { row: null };
  const matching = rows.filter((r) => r.form_type === formType && r.file_url);
  if (matching.length === 0) return { row: null };
  return {
    row: matching.reduce((best, r) => ((r.version ?? 0) > (best.version ?? 0) ? r : best)),
  };
}

/**
 * Download a file_url through the background proxy and wrap it as a File.
 *
 * Returns the reason on failure instead of only logging it. A blocked origin
 * ("not in the extension's allowlist") is a CONFIGURATION bug, not a missing
 * document, and telling the user to "upload it in ParaLeagle" would send them
 * chasing a file that is already there.
 */
async function downloadAsFile(
  url: string,
  accessToken: string,
  filename: string,
): Promise<{ file: File | null; error?: string }> {
  let response: { success?: boolean; error?: string; data?: number[]; contentType?: string } | undefined;
  try {
    response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_FILE", url, accessToken });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    dbg(`doc-flow: download could not reach the background worker: ${error}`);
    return { file: null, error: `Download failed — ${error}` };
  }
  if (!response?.success) {
    // The proxy reports a failed fetch as "HTTP <status>"; a 401 there means the
    // mirrored token aged out, which is worth naming rather than showing raw.
    const error = String(response?.error ?? "unknown error");
    const message = /\b401\b/.test(error)
      ? `Download of ${filename}: ${SESSION_EXPIRED_MESSAGE}`
      : `Download of ${filename} failed — ${error}`;
    dbg(`doc-flow: ${message}`);
    return { file: null, error: message };
  }
  const blob = new Blob([new Uint8Array(response.data ?? [])], { type: response.contentType });
  return { file: new File([blob], filename, { type: response.contentType }) };
}

/** Files this descriptor resolved to, plus any hard failures worth surfacing. */
interface ResolvedFiles {
  files: File[];
  errors: string[];
}

/** Resolve one upload-page descriptor to the File(s) it needs. */
async function resolveFilesFor(
  descriptor: UploadPageDescriptor,
  docs: DocRow[],
  ctx: ResolveContext,
): Promise<ResolvedFiles> {
  if (descriptor.kind === "document") {
    const wanted = (descriptor.doc_type || "").toLowerCase();
    const wantParty = descriptor.party?.toUpperCase();
    const matches = docs.filter((d) => {
      if ((d.doc_type || "").toLowerCase() !== wanted) return false;
      if (wantParty && (d.party || "").toUpperCase() !== wantParty) return false;
      return !!d.file_url;
    });
    const files: File[] = [];
    const errors: string[] = [];
    for (const m of matches) {
      const name = m.filename || `${m.doc_type}.pdf`;
      const { file, error } = await downloadAsFile(m.file_url as string, ctx.accessToken, name);
      if (file) files.push(file);
      else if (error) errors.push(error);
    }
    return { files, errors };
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
      return { files: [], errors: [] };
    }
    const { row, error } = await fetchGeneratedForm(ctx, formType);
    if (error) return { files: [], errors: [error] };
    if (!row || !row.file_url) {
      dbg(
        `doc-flow: no generated ${formType} on file for this case — generate it in ` +
          `ParaLeagle before attaching.`,
      );
      return { files: [], errors: [] };
    }
    const { file, error: downloadError } = await downloadAsFile(
      row.file_url,
      ctx.accessToken,
      `${formType}.pdf`,
    );
    return { files: file ? [file] : [], errors: downloadError ? [downloadError] : [] };
  }

  return { files: [], errors: [] };
}

/**
 * A human label for the document an upload page expects — its doc_type for a
 * stored document, or the form_type for a generated form (e.g. "I-130A").
 */
function missingDocLabel(descriptor: UploadPageDescriptor): string {
  if (descriptor.kind === "generated_form") return descriptor.form_type || "form";
  return descriptor.doc_type || "document";
}

/**
 * For the current upload page, resolve its descriptor's files and attach them.
 * `descriptor` is the matching entry from the stored upload_pages list.
 *
 * When nothing resolves for a required upload page we surface a clear,
 * actionable warning (naming the missing document and pointing at ParaLeagle)
 * instead of a near-silent "No file resolved" — the "No …" prefix is what the
 * debug panel highlights (see engine/logger.applyLineStyle), so it reads as a
 * warning, not a quiet skip (SOF-892).
 *
 * A FAILED read/download is reported as itself, never as "no document on file".
 * Those two need opposite remedies: one is ours to fix, the other is the firm's.
 *
 * NEVER THROWS — see the module header. A rejection here propagates through
 * fillAll and kills the whole walk with no log line.
 */
export async function fillUploadPage(
  descriptor: UploadPageDescriptor,
  ctx: ResolveContext,
): Promise<{ attached: number; warnings: string[] }> {
  let docs: DocRow[] = [];
  if (descriptor.kind === "document") {
    const listed = await fetchDocuments(ctx);
    if (listed.error) {
      return {
        attached: 0,
        warnings: [`Could not attach to ${descriptor.page_path} — ${listed.error}`],
      };
    }
    docs = listed.rows;
  }

  const { files, errors } = await resolveFilesFor(descriptor, docs, ctx);
  if (files.length === 0) {
    if (errors.length > 0) {
      return {
        attached: 0,
        warnings: errors.map((e) => `Could not attach to ${descriptor.page_path} — ${e}`),
      };
    }
    const label = missingDocLabel(descriptor);
    return {
      attached: 0,
      warnings: [
        `No ${label} on file for ${descriptor.page_path} — upload it in ParaLeagle first, then re-run.`,
      ],
    };
  }
  // Some files resolved and some failed: attach what we have, but say so.
  const result = await attachFiles(files);
  return { ...result, warnings: [...result.warnings, ...errors] };
}

/** Match a stored upload-page descriptor to the current URL path. */
export function descriptorForPath(
  path: string,
  uploadPages: UploadPageDescriptor[],
): UploadPageDescriptor | null {
  const p = path.replace(/\/$/, "");
  return uploadPages.find((d) => p.endsWith(d.page_path.replace(/\/$/, ""))) ?? null;
}
