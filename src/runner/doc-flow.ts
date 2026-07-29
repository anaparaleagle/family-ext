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

import { attachFiles, attachedFileRowTexts, isFilenameAttached } from "../engine/doc-uploader";
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
/** Decode the proxy's base64 payload back into bytes. */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function downloadAsFile(
  url: string,
  accessToken: string,
  filename: string,
): Promise<{ file: File | null; error?: string }> {
  let response:
    | {
        success?: boolean;
        error?: string;
        /** Base64 — the only form the proxy sends now. See toBase64 for why. */
        dataBase64?: string;
        byteLength?: number;
        /** Legacy number-array form. Kept ONLY so a stale content script paired
         * with a reloaded worker (or vice versa) degrades instead of silently
         * attaching an empty file. */
        data?: number[];
        contentType?: string;
      }
    | undefined;
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
  let bytes: Uint8Array<ArrayBuffer>;
  if (response.dataBase64) {
    bytes = fromBase64(response.dataBase64);
  } else {
    // Legacy number-array form — see the type above. Reached only when a
    // reloaded content script is talking to a worker Chrome has not restarted.
    const legacy = response.data ?? [];
    bytes = new Uint8Array(new ArrayBuffer(legacy.length));
    bytes.set(legacy);
  }
  if (bytes.length === 0) {
    // An empty file attaches "successfully" and USCIS holds a 0-byte document.
    // Better to name it than to let a silent zero pass as an upload.
    const message = `Download of ${filename} returned 0 bytes — nothing attached.`;
    dbg(`doc-flow: ${message}`);
    return { file: null, error: message };
  }
  dbg(`doc-flow: downloaded ${filename} (${Math.round(bytes.length / 1024)} KB)`);
  const blob = new Blob([bytes], { type: response.contentType });
  return { file: new File([blob], filename, { type: response.contentType }) };
}

/**
 * Files this descriptor resolved to, plus any hard failures worth surfacing, plus
 * how many were skipped because the page already shows them (SOF-1005). All
 * three are distinct outcomes with opposite remedies: attach these, fix this,
 * do nothing.
 */
interface ResolvedFiles {
  files: File[];
  errors: string[];
  alreadyAttached: number;
}

/** Resolve one upload-page descriptor to the File(s) it needs.
 *
 * SOF-1005: a file the page is ALREADY showing is skipped here, before it is
 * downloaded. The filename is known from the listing, so the wasteful half (the
 * proxy fetch of the bytes) is avoided rather than downloading and then dropping
 * it at the DataTransfer. `alreadyAttached` is returned so the caller can report
 * a do-nothing run as "already attached" instead of a bare "0 attached". */
async function resolveFilesFor(
  descriptor: UploadPageDescriptor,
  docs: DocRow[],
  ctx: ResolveContext,
): Promise<ResolvedFiles> {
  const rowTexts = attachedFileRowTexts();

  if (descriptor.kind === "document") {
    const wanted = (descriptor.doc_type || "").toLowerCase();
    const wantParty = descriptor.party?.toUpperCase();
    const matches = docs.filter((d) => {
      if ((d.doc_type || "").toLowerCase() !== wanted) return false;
      if (wantParty && (d.party || "").toUpperCase() !== wantParty) return false;
      return !!d.file_url;
    });
    // What this slot wanted, what the case holds, and what therefore did NOT go
    // up. The last part is the interesting half: an evidence slot silently
    // leaving a document behind looks identical to a slot with nothing to do,
    // and "the SSN card must never be uploaded to Evidence" is a rule we can only
    // claim to honour if the log shows the card being left out on purpose.
    dbg(
      `doc-flow: ${descriptor.page_path} wants doc_type "${wanted}"` +
        `${wantParty ? ` for party ${wantParty}` : ""} — ` +
        `${matches.length} of ${docs.length} case document(s) match`,
    );
    if (docs.length) {
      const others = [...new Set(docs.map((d) => (d.doc_type || "?").toLowerCase()))]
        .filter((t) => t !== wanted)
        .sort();
      if (others.length) dbg(`  not for this slot: ${others.join(", ")}`);
    }
    const files: File[] = [];
    const errors: string[] = [];
    let alreadyAttached = 0;
    for (const m of matches) {
      const name = m.filename || `${m.doc_type}.pdf`;
      // SOF-1005: skip BEFORE downloading. The filename is known from the
      // listing, so the wasteful half (the proxy fetch of the bytes) is avoided.
      if (isFilenameAttached(name, rowTexts)) {
        dbg(`doc-flow: "${name}" is already attached to ${descriptor.page_path} — skipping`);
        alreadyAttached += 1;
        continue;
      }
      const { file, error } = await downloadAsFile(m.file_url as string, ctx.accessToken, name);
      if (file) files.push(file);
      else if (error) errors.push(error);
    }
    return { files, errors, alreadyAttached };
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
      return { files: [], errors: [], alreadyAttached: 0 };
    }
    const name = `${formType}.pdf`;
    // Checked before the listing call: if it is already on the page there is
    // nothing this visit can usefully do.
    if (isFilenameAttached(name, rowTexts)) {
      dbg(`doc-flow: "${name}" is already attached to ${descriptor.page_path} — skipping`);
      return { files: [], errors: [], alreadyAttached: 1 };
    }
    const { row, error } = await fetchGeneratedForm(ctx, formType);
    if (error) return { files: [], errors: [error], alreadyAttached: 0 };
    if (!row || !row.file_url) {
      dbg(
        `doc-flow: no generated ${formType} on file for this case — generate it in ` +
          `ParaLeagle before attaching.`,
      );
      return { files: [], errors: [], alreadyAttached: 0 };
    }
    const { file, error: downloadError } = await downloadAsFile(
      row.file_url,
      ctx.accessToken,
      name,
    );
    return {
      files: file ? [file] : [],
      errors: downloadError ? [downloadError] : [],
      alreadyAttached: 0,
    };
  }

  return { files: [], errors: [], alreadyAttached: 0 };
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
): Promise<{ attached: number; alreadyAttached: number; warnings: string[] }> {
  let docs: DocRow[] = [];
  if (descriptor.kind === "document") {
    const listed = await fetchDocuments(ctx);
    if (listed.error) {
      return {
        attached: 0,
        alreadyAttached: 0,
        warnings: [`Could not attach to ${descriptor.page_path} — ${listed.error}`],
      };
    }
    docs = listed.rows;
  }

  const { files, errors, alreadyAttached } = await resolveFilesFor(descriptor, docs, ctx);
  if (files.length === 0) {
    // Nothing to attach, for three very different reasons — and they need
    // opposite remedies, so they must never collapse into one message.
    // A FAILED read/download is ours to fix and comes first.
    if (errors.length > 0) {
      return {
        attached: 0,
        alreadyAttached,
        warnings: errors.map((e) => `Could not attach to ${descriptor.page_path} — ${e}`),
      };
    }
    // Everything already on the page is the SUCCESS case (a re-run, a
    // back/forward, or the SPA re-firing the hook) and must not be dressed up as
    // a missing document — that warning tells the user to go upload a file they
    // already uploaded.
    if (alreadyAttached > 0) {
      dbg(
        `doc-flow: ${descriptor.page_path} already has all ${alreadyAttached} ` +
          `file(s) attached — nothing to do`,
      );
      return { attached: 0, alreadyAttached, warnings: [] };
    }
    const label = missingDocLabel(descriptor);
    return {
      attached: 0,
      alreadyAttached: 0,
      warnings: [
        `No ${label} on file for ${descriptor.page_path} — upload it in ParaLeagle first, then re-run.`,
      ],
    };
  }
  // Some files resolved and some failed: attach what we have, but say so.
  // resolveFilesFor already dropped the already-attached ones, so attachFiles'
  // own count is 0 on this path; summing keeps the total right for any other
  // caller too.
  const result = await attachFiles(files);
  return {
    ...result,
    alreadyAttached: result.alreadyAttached + alreadyAttached,
    warnings: [...result.warnings, ...errors],
  };
}

/** Match a stored upload-page descriptor to the current URL path. */
export function descriptorForPath(
  path: string,
  uploadPages: UploadPageDescriptor[],
): UploadPageDescriptor | null {
  const p = path.replace(/\/$/, "");
  return uploadPages.find((d) => p.endsWith(d.page_path.replace(/\/$/, ""))) ?? null;
}
