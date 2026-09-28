import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fillUploadPage,
  fillUploadPageAll,
  descriptorsForPath,
  descriptorsForPage,
  splitByAccept,
  strayDescriptors,
} from "../src/runner/doc-flow";
import { fillAll, unvisitedUploadSlugsBefore, type UploadWalkContext } from "../src/runner/fill-chain";
import { configForFormType } from "../src/runner/registry";
import type { UploadPageDescriptor } from "../src/runner/payload";
import type { FormConfig, FormPage } from "../src/runner/types";
import {
  I485J_BASE,
  I485J_SLUGS,
  I485J_UPLOAD_PAGES,
  USCIS_FILENAME,
} from "./fixtures/i485j-inferred";

const CTX = {
  apiBaseUrl: "http://localhost:8001/api/v1",
  accessToken: "tok",
  caseId: "case-123",
};

/** Minimal dropzone so engine/doc-uploader.attachFiles has an input + a way to
 * acknowledge the upload (a Remove control appears after inject).
 *
 * SOF-1005: the acknowledgement now renders ONE ROW PER FILE carrying that file's
 * NAME beside its Remove control, which is what myUSCIS actually shows. The name
 * on the page is the only evidence a file is already attached, so the de-dupe
 * needs it to be there — a bare Remove button with no name could not be matched
 * back to a file. */
function mountDropzone(): void {
  document.body.innerHTML =
    '<div class="dropzone"><input type="file" id="desktop-drop" /></div>';
  const input = document.getElementById("desktop-drop") as HTMLInputElement;
  input.addEventListener("change", () => {
    for (const file of Array.from(input.files ?? [])) {
      // NO de-dupe here on purpose: myUSCIS accepts the same filename twice and
      // lists it twice. That IS the bug SOF-1005 fixes, so the mock must be able
      // to show two rows — otherwise the "exactly one copy" test could never fail
      // and would be asserting the mock's behaviour instead of the code's.
      const row = document.createElement("div");
      row.className = "uploaded-file";
      const name = document.createElement("span");
      name.textContent = file.name;
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "Remove";
      row.appendChild(name);
      row.appendChild(btn);
      document.body.appendChild(row);
    }
  });
}

/** Bytes the fake proxy hands back for any DOWNLOAD_FILE, in the real wire
 * format: base64, not a number array (see download-proxy.toBase64). */
const PDF_BASE64 = btoa("%PD");

/**
 * Install a fake service worker.
 *
 * `apiResponder` answers API_GET by path; DOWNLOAD_FILE always succeeds unless
 * `downloadResponder` says otherwise. Everything the runner does must go through
 * here — see the "never calls fetch directly" test for why that matters.
 */
function installProxy(opts: {
  apiResponder?: (path: string) => unknown;
  downloadResponder?: (url: string) => unknown;
} = {}): any {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "API_GET") {
      const responder = opts.apiResponder;
      if (!responder) return { success: true, status: 200, data: { results: [] } };
      return responder(message.path);
    }
    if (message.type === "DOWNLOAD_FILE") {
      const responder = opts.downloadResponder;
      if (responder) return responder(message.url);
      return { success: true, dataBase64: PDF_BASE64, contentType: "application/pdf" };
    }
    throw new Error(`unexpected message type ${message.type}`);
  });
  (globalThis as any).chrome = { runtime: { sendMessage } };
  return sendMessage;
}

/** An API_GET success envelope. */
function apiOk(results: unknown[]): unknown {
  return { success: true, status: 200, data: { results } };
}

let fetchSpy: any;

beforeEach(() => {
  mountDropzone();
  // Any direct fetch from runner code is a BUG (MV3 blocks it cross-origin from
  // a content script). Install a spy that fails loudly if anything calls it.
  fetchSpy = vi.fn(async () => {
    throw new Error("runner code must not call fetch directly");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("doc-flow: transport", () => {
  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // doc-flow used to `fetch` the family API straight from the content script. A
  // content script runs at my.uscis.gov's origin and MV3 does not exempt it from
  // CORS, so the preflight was refused (prod logs 2026-07-27: OPTIONS
  // /api/v1/documents/ answered 218 bytes with no Access-Control-Allow-* headers,
  // and the real GET was never sent). The rejected fetch was uncaught and killed
  // the whole walk. Every API read must go through the service worker.
  it("reads the documents list via the service worker, never via fetch", async () => {
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "i94",
            file_url: "http://localhost:8001/media/i94.pdf",
            filename: "i94.pdf",
          },
        ]),
    });

    const res = await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );

    expect(res.attached).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: "API_GET",
      apiBaseUrl: "http://localhost:8001/api/v1",
      path: "/documents/?case=case-123",
      accessToken: "tok",
    });
  });

  it("warns instead of throwing when the API is unreachable (CORS refusal)", async () => {
    // What a CORS-refused request looks like coming back from the worker.
    installProxy({
      apiResponder: () => ({ success: false, error: "Failed to fetch" }),
    });

    const promise = fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    // MUST resolve. A rejection here is what silently ended the walk.
    await expect(promise).resolves.toBeDefined();
    const res = await promise;
    expect(res.attached).toBe(0);
    expect(res.warnings.join(" ")).toMatch(/could not reach the ParaLeagle API/i);
  });

  it("does not blame the firm for a failure that is ours to fix", async () => {
    // A transport failure must NOT say "upload it in ParaLeagle first" — the
    // document may well be there; the request never arrived.
    installProxy({ apiResponder: () => ({ success: false, error: "Failed to fetch" }) });
    const res = await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    expect(res.warnings.join(" ")).not.toMatch(/upload it in ParaLeagle first/i);
  });

  it("resolves (not rejects) when the background worker is gone", async () => {
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error("Receiving end does not exist");
        }),
      },
    };
    const res = await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    expect(res.attached).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("names a session expiry on 401 rather than a generic failure", async () => {
    installProxy({ apiResponder: () => ({ success: false, status: 401, error: "HTTP 401" }) });
    const res = await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    expect(res.warnings.join(" ")).toMatch(/session expired/i);
  });

  it("reports a blocked download origin as a config problem, not a missing doc", async () => {
    // Prod file_urls are presigned S3. If the proxy allowlist ever misses the
    // media origin, the user must not be told the document is absent.
    installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "i94",
            file_url: "https://some-bucket.s3.eu-west-2.amazonaws.com/x.pdf?X-Amz-Signature=a",
            filename: "i94.pdf",
          },
        ]),
      downloadResponder: () => ({
        success: false,
        error: "Download blocked — https://evil.example is not in the extension's allowlist.",
      }),
    });
    const res = await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    expect(res.attached).toBe(0);
    const warning = res.warnings.join(" ");
    expect(warning).toMatch(/allowlist/i);
    expect(warning).not.toMatch(/upload it in ParaLeagle first/i);
  });
});

describe("doc-flow: generated_form (I-130A) resolution", () => {
  it("hits GET /forms/generated/?case=<id> and attaches the latest I-130A file", async () => {
    const sendMessage = installProxy({
      apiResponder: (path) => {
        expect(path).toBe("/forms/generated/?case=case-123&form_type=I-130A");
        return apiOk([
          { id: "g1", form_type: "I-130A", version: 1, file_url: "http://localhost:8001/media/i130a_v1.pdf" },
          { id: "g2", form_type: "I-130A", version: 2, file_url: "http://localhost:8001/media/i130a_v2.pdf" },
          { id: "g3", form_type: "I-130", version: 1, file_url: "http://localhost:8001/media/i130.pdf" },
        ]);
      },
    });

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/i130a-supplimental-information-for-spouse-beneficiary",
      kind: "generated_form",
      form_type: "I-130A",
    };

    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);

    // It downloaded the LATEST (version 2) file_url via the proxy, not v1 or the I-130.
    const downloads = sendMessage.mock.calls
      .map((c: any) => c[0])
      .filter((m: any) => m.type === "DOWNLOAD_FILE");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({
      type: "DOWNLOAD_FILE",
      url: "http://localhost:8001/api/v1/forms/generated/g2/uscis-file/",
    });
  });

  it("names a live record whose FILE is gone, not a form that was never generated", async () => {
    // The I-485's G-28 on 2026-09-15: the listing had the row, its file_url
    // answered 404. "Generate it" is the wrong remedy for that.
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "g1", form_type: "G-28-BEN", version: 1, file_url: "https://x/media/g28.pdf" },
        ]),
      downloadResponder: () => ({ success: false, error: "HTTP 404" }),
    });
    const descriptor: UploadPageDescriptor = {
      page_path: "/form-g28",
      kind: "generated_form",
      form_type: "G-28-BEN",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(0);
    expect(res.warnings[0]).toMatch(/lists a generated G-28-BEN .* missing \(404\)/);
  });

  it("warns (no attach) when no generated form of that type is on file", async () => {
    installProxy({ apiResponder: () => apiOk([]) });
    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/i130a-supplimental-information-for-spouse-beneficiary",
      kind: "generated_form",
      form_type: "I-130A",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});

describe("doc-flow: document resolution", () => {
  it("hits GET /documents/?case=<id>, matches doc_type, and attaches", async () => {
    const sendMessage = installProxy({
      apiResponder: (path) => {
        expect(path).toBe("/documents/?case=case-123");
        return apiOk([
          { id: "d1", doc_type: "marriage_certificate", file_url: "http://localhost:8001/media/marriage.pdf", filename: "marriage.pdf" },
          { id: "d2", doc_type: "photos", file_url: "http://localhost:8001/media/photo.jpg" },
        ]);
      },
    });

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/proof-of-marriage",
      kind: "document",
      doc_type: "marriage_certificate",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);
    const downloads = sendMessage.mock.calls
      .map((c: any) => c[0])
      .filter((m: any) => m.type === "DOWNLOAD_FILE");
    expect(downloads[0].url).toBe("http://localhost:8001/api/v1/documents/d1/uscis-file/");
  });

  it("warns the user to upload in ParaLeagle when no document matches", async () => {
    // SOF-892: a required evidence page with no matching document was a
    // near-silent no-op ("No file resolved for …"). The warning must instead be
    // user-facing and actionable — name the missing doc and point at ParaLeagle.
    installProxy({ apiResponder: () => apiOk([]) });
    const descriptor: UploadPageDescriptor = {
      page_path: "/evidence/form-i-94",
      kind: "document",
      doc_type: "i94",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
    const warning = res.warnings.join(" ");
    expect(warning).toMatch(/i94/i); // names the missing document
    expect(warning).toMatch(/ParaLeagle/i); // tells the user how to fix it
  });

  it("filters documents by party when the descriptor scopes one", async () => {
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([
          { id: "p1", doc_type: "photos", party: "PETITIONER", file_url: "http://localhost:8001/media/pet.jpg" },
          { id: "p2", doc_type: "photos", party: "APPLICANT", file_url: "http://localhost:8001/media/app.jpg" },
        ]),
    });

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/photo-of-spouse",
      kind: "document",
      doc_type: "photos",
      party: "APPLICANT",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);
    const downloads = sendMessage.mock.calls
      .map((c: any) => c[0])
      .filter((m: any) => m.type === "DOWNLOAD_FILE");
    expect(downloads[0].url).toBe("http://localhost:8001/api/v1/documents/p2/uscis-file/");
  });

  it("attaches what resolved and still reports the file that failed", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "p1", doc_type: "photos", file_url: "http://localhost:8001/media/ok.jpg", filename: "ok.jpg" },
          { id: "p2", doc_type: "photos", file_url: "http://localhost:8001/media/bad.jpg", filename: "bad.jpg" },
        ]),
      downloadResponder: (url) =>
        url.endsWith("bad.jpg") || url.includes("/p2/")
          ? { success: false, error: "HTTP 500" }
          : { success: true, dataBase64: PDF_BASE64, contentType: "image/jpeg" },
    });
    const res = await fillUploadPage(
      { page_path: "/evidences/photo-of-spouse", kind: "document", doc_type: "photos" },
      CTX,
    );
    expect(res.attached).toBe(1);
    expect(res.warnings.join(" ")).toMatch(/bad\.jpg/);
  });
});

describe("doc-flow: a document uploads to USCIS exactly once (SOF-1005)", () => {
  const descriptor: UploadPageDescriptor = {
    page_path: "/evidences/proof-of-marriage",
    kind: "document",
    doc_type: "marriage_certificate",
  };

  const MARRIAGE_DOC = {
    id: "d1",
    doc_type: "marriage_certificate",
    file_url: "http://localhost:8001/media/marriage.pdf",
    filename: "marriage.pdf",
  };

  /** The documents list read goes through the service worker, not fetch. */
  function stubOneDocument(): any {
    return installProxy({ apiResponder: () => apiOk([MARRIAGE_DOC]) });
  }

  /** How many times the proxy was asked to download bytes (not API reads). */
  function downloadCount(sendMessage: any): number {
    return sendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "DOWNLOAD_FILE").length;
  }

  it("attaches nothing on a second visit to the same page, and says so", async () => {
    // The reported bug: any second visit re-attached everything — a Fill All
    // re-run, a back/forward through the walk, or the SPA re-firing the
    // page-change hook. USCIS then holds two copies of the same evidence.
    stubOneDocument();
    const first = await fillUploadPage(descriptor, CTX);
    expect(first.attached).toBe(1);

    const second = await fillUploadPage(descriptor, CTX);
    expect(second.attached).toBe(0);
    // Reported separately from "attached" so the debug panel does not read this
    // as a silent no-op.
    expect(second.alreadyAttached).toBe(1);
  });

  it("leaves exactly one copy of the file on the page after two runs", async () => {
    // The user-visible consequence, asserted on the DOM rather than the return
    // value: one row for the file, not two.
    stubOneDocument();
    await fillUploadPage(descriptor, CTX);
    await fillUploadPage(descriptor, CTX);
    const rows = document.querySelectorAll(".uploaded-file");
    expect(rows.length).toBe(1);
  });

  it("does not re-download a file it is going to skip", async () => {
    // Dropping the File before the DataTransfer is built is not enough — the
    // background proxy fetch is the expensive half, so an already-attached file
    // must not be fetched again either.
    const sendMessage = stubOneDocument();
    await fillUploadPage(descriptor, CTX);
    const downloadsAfterFirst = downloadCount(sendMessage);

    await fillUploadPage(descriptor, CTX);
    // Counts DOWNLOAD_FILE only. The second visit still reads the documents
    // list (that is how it learns the filename to compare), so a total
    // message count would rise for a correct run.
    expect(downloadCount(sendMessage)).toBe(downloadsAfterFirst);
  });

  it("still attaches a genuinely new file when one is already on the page", async () => {
    // The de-dupe must be per-FILE, not "page already has something" — otherwise
    // a second evidence document on a multi-file slot would be dropped.
    stubOneDocument();
    await fillUploadPage(descriptor, CTX);

    // Same case, now with a second page of the certificate on file.
    installProxy({
      apiResponder: () =>
        apiOk([
          MARRIAGE_DOC,
          {
            id: "d2",
            doc_type: "marriage_certificate",
            file_url: "http://localhost:8001/media/marriage_page2.pdf",
            filename: "marriage_page2.pdf",
          },
        ]),
    });

    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1); // the new one
    expect(res.alreadyAttached).toBe(1); // the one already there
    expect(document.querySelectorAll(".uploaded-file").length).toBe(2);
  });
});

// ===========================================================================
// ONE EVIDENCE SLOT, SEVERAL DOCUMENT TYPES
//
// "Proof of ability to pay" takes bank statements AND a financial affidavit AND
// sponsor pay stubs. The backend expresses that as three upload_pages entries
// sharing one page_path (its resolver appends, so duplicates are fine there).
// The extension used to take only the FIRST match for a path, so two thirds of
// the slot was dropped and the log still said "1 attached" as though the slot
// were satisfied.
//
// Found live 2026-07-29 (FAM-0100): /evidence/proof-of-ability-to-pay was not in
// the descriptor at all, the page stayed empty, Next never enabled and the walk
// could not reach Review.
// ===========================================================================

describe("doc-flow: an evidence slot fed by several doc types", () => {
  const PAGE = "/evidence/proof-of-ability-to-pay";
  const descriptors: UploadPageDescriptor[] = [
    { page_path: PAGE, kind: "document", doc_type: "bank_statement" },
    { page_path: PAGE, kind: "document", doc_type: "financial_affidavit" },
    { page_path: PAGE, kind: "document", doc_type: "pay_stubs" },
  ];

  it("returns every descriptor for a path, not just the first", () => {
    const all = descriptorsForPath(`/forms/x/13359458${PAGE}`, [
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      ...descriptors,
    ]);
    expect(all.map((d) => d.doc_type)).toEqual([
      "bank_statement",
      "financial_affidavit",
      "pay_stubs",
    ]);
  });

  it("attaches documents of ALL the slot's types in one batch", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "d1", doc_type: "bank_statement", file_url: "http://localhost:8001/m/b1.pdf", filename: "b1.pdf" },
          { id: "d2", doc_type: "bank_statement", file_url: "http://localhost:8001/m/b2.pdf", filename: "b2.pdf" },
          { id: "d3", doc_type: "financial_affidavit", file_url: "http://localhost:8001/m/aff.pdf", filename: "aff.pdf" },
          { id: "d4", doc_type: "pay_stubs", file_url: "http://localhost:8001/m/stub.pdf", filename: "stub.pdf" },
          // Not for this slot — must not ride along.
          { id: "d5", doc_type: "i94", file_url: "http://localhost:8001/m/i94.pdf", filename: "i94.pdf" },
        ]),
    });
    const res = await fillUploadPageAll(descriptors, CTX);
    expect(res.attached).toBe(4);
    expect(document.querySelectorAll(".uploaded-file").length).toBe(4);
  });

  it("is satisfied when only ONE of its types is on file", async () => {
    // A case with bank statements but no affidavit has met the slot. Warning per
    // absent type would train people to ignore warnings.
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "d1", doc_type: "bank_statement", file_url: "http://localhost:8001/m/b1.pdf", filename: "b1.pdf" },
        ]),
    });
    const res = await fillUploadPageAll(descriptors, CTX);
    expect(res.attached).toBe(1);
    expect(res.warnings).toEqual([]);
  });

  it("names every accepted type when the slot is empty", async () => {
    installProxy({ apiResponder: () => apiOk([]) });
    const res = await fillUploadPageAll(descriptors, CTX);
    expect(res.attached).toBe(0);
    // Not just "no bank_statement" — that sends someone hunting for one document
    // when any of three would do.
    expect(res.warnings.join(" ")).toContain("bank_statement / financial_affidavit / pay_stubs");
  });

  it("reads the documents list ONCE for the whole page, not once per type", async () => {
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([
          { id: "d1", doc_type: "bank_statement", file_url: "http://localhost:8001/m/b1.pdf", filename: "b1.pdf" },
        ]),
    });
    await fillUploadPageAll(descriptors, CTX);
    const listReads = sendMessage.mock.calls.filter(
      (c: any[]) => c[0]?.type === "API_GET" && String(c[0]?.path).startsWith("/documents/"),
    );
    expect(listReads.length).toBe(1);
  });
});

// ===========================================================================
// A FILE USCIS WILL NOT ACCEPT
//
// Live, 2026-07-29 (FAM-0100): the I-20 on that case is 34.6 MB. We downloaded
// all of it, base64'd it, pushed it into the dropzone, and USCIS answered
// "This file is too big. You must upload a file that is 12MB or smaller."
//
// Worse, it happened TWICE. A rejected row renders without the Remove control the
// de-dupe keys off, so `attachedFileRowTexts` cannot see it and every re-run
// attaches another copy. Attaching something we know USCIS refuses buys nothing
// and costs a confusing error, a duplicate row and 34.6 MB of transfer.
// ===========================================================================

describe("doc-flow: a document larger than USCIS accepts", () => {
  /**
   * A download whose DECODED size is over the 12 MB dropzone limit.
   *
   * Note the 4/3: base64 is bigger than the bytes it carries, so 13 MB of base64
   * decodes to only ~9.7 MB and would be perfectly acceptable. 17 MB of base64
   * decodes to ~12.75 MB, which is the thing being tested.
   */
  function oversizedProxy(): void {
    const big = "A".repeat(17 * 1024 * 1024);
    installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "form_i20",
            file_url: "http://localhost:8001/media/form_i20.pdf",
            filename: "form_i20.pdf",
          },
        ]),
      downloadResponder: () => ({
        success: true,
        dataBase64: big,
        contentType: "application/pdf",
      }),
    });
  }

  it("refuses to attach it, rather than letting USCIS reject it", async () => {
    oversizedProxy();
    const res = await fillUploadPage(
      { page_path: "/evidence/form-I-20", kind: "document", doc_type: "form_i20" },
      CTX,
    );
    expect(res.attached).toBe(0);
    // Nothing reached the dropzone, so no rejected row to duplicate next run.
    expect(document.querySelectorAll(".uploaded-file").length).toBe(0);
  }, 30000);

  it("says which file, how big it is, and what USCIS allows", async () => {
    oversizedProxy();
    const res = await fillUploadPage(
      { page_path: "/evidence/form-I-20", kind: "document", doc_type: "form_i20" },
      CTX,
    );
    const warning = res.warnings.join(" ");
    expect(warning).toContain("form_i20.pdf");
    expect(warning).toMatch(/12 ?MB/);
    // And it must NOT read as "no document on file" — the document is there, it is
    // just unusable, and those two need opposite remedies.
    expect(warning).not.toMatch(/upload it in ParaLeagle first/i);
  }, 30000);

  it("still attaches a file the listing reports as a legal size", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "form_i20",
            file_url: "http://localhost:8001/media/form_i20.pdf",
            filename: "form_i20.pdf",
            size_bytes: 900_000,
            too_big_for_uscis: false,
          },
        ]),
    });
    const res = await fillUploadPage(
      { page_path: "/evidence/form-I-20", kind: "document", doc_type: "form_i20" },
      CTX,
    );
    expect(res.attached).toBe(1);
  });
});

// ── A slot that will not take this file type ────────────────────────────────
//
// Live I-131 run, 2026-09-15: /photo-id/I-131/evidence accepts image/jpeg and
// image/png ONLY. Two PDFs were handed to it. The run logged "2 attached",
// reported FAILURES: none — and the page showed "Missing Evidence" with nothing
// on it. A dropzone DISCARDS a wrong-typed file in silence, so the filing read
// as complete here and was empty at USCIS. That is the shape of bug this guard
// exists to make impossible.

/** A dropzone that only takes what its `accept` allows — like the real one. */
function mountTypedDropzone(accept: string): void {
  document.body.innerHTML =
    `<div class="dropzone"><input type="file" id="desktop-drop" accept="${accept}" /></div>`;
  const input = document.getElementById("desktop-drop") as HTMLInputElement;
  const allowed = accept.split(",").map((a) => a.trim().toLowerCase());
  input.addEventListener("change", () => {
    for (const file of Array.from(input.files ?? [])) {
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      const ok = allowed.includes((file.type || "").toLowerCase()) || allowed.includes(ext);
      if (!ok) continue; // silently discarded, exactly as myUSCIS does
      const row = document.createElement("div");
      row.className = "uploaded-file";
      row.innerHTML = `<span>${file.name}</span><button>Remove</button>`;
      document.querySelector(".dropzone")!.appendChild(row);
    }
  });
}

describe("doc-flow: splitByAccept", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });

  it("takes everything when the slot declares no accept list", () => {
    const files = [file("a.pdf", "application/pdf")];
    expect(splitByAccept(files, "").accepted).toEqual(files);
    expect(splitByAccept(files, null).accepted).toEqual(files);
  });

  it("matches by MIME type", () => {
    const { accepted, refused } = splitByAccept(
      [file("photo.jpg", "image/jpeg"), file("scan.pdf", "application/pdf")],
      "image/jpeg,.jpeg,.png,.jpg",
    );
    expect(accepted.map((f) => f.name)).toEqual(["photo.jpg"]);
    expect(refused.map((f) => f.name)).toEqual(["scan.pdf"]);
  });

  it("matches by EXTENSION too — these lists mix both", () => {
    // A file the proxy handed us with no MIME still has a name.
    const { accepted } = splitByAccept([file("photo.png", "")], "image/jpeg,.jpeg,.png,.jpg");
    expect(accepted.map((f) => f.name)).toEqual(["photo.png"]);
  });

  it("honours a type/* wildcard", () => {
    const { accepted, refused } = splitByAccept(
      [file("photo.heic", "image/heic"), file("scan.pdf", "application/pdf")],
      "image/*",
    );
    expect(accepted.map((f) => f.name)).toEqual(["photo.heic"]);
    expect(refused.map((f) => f.name)).toEqual(["scan.pdf"]);
  });

  it("ignores the ORDER of the list — it is a set, not a string", () => {
    // The I-131's photo slot lists .png before .jpg; the I-485's does the
    // opposite. Comparing these as strings would call them different.
    const files = [file("photo.jpg", "image/jpeg")];
    expect(splitByAccept(files, "image/jpeg,.jpeg,.png,.jpg").accepted).toHaveLength(1);
    expect(splitByAccept(files, "image/jpeg,.jpeg,.jpg,.png").accepted).toHaveLength(1);
  });
});

describe("doc-flow: a document the slot will not accept", () => {
  function pdfForAPhotoSlot(): void {
    installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "passport",
            file_url: "http://localhost:8001/media/passport.pdf",
            filename: "passport.pdf",
          },
        ]),
      downloadResponder: () => ({
        success: true,
        dataBase64: btoa("pdf bytes"),
        contentType: "application/pdf",
      }),
    });
  }

  it("does not hand a PDF to a jpeg/png-only slot", async () => {
    mountTypedDropzone("image/jpeg,.jpeg,.png,.jpg");
    pdfForAPhotoSlot();
    const res = await fillUploadPage(
      { page_path: "/photo-id/I-131/evidence", kind: "document", doc_type: "passport" },
      CTX,
    );
    expect(res.attached).toBe(0);
    expect(document.querySelectorAll(".uploaded-file").length).toBe(0);
  }, 30000);

  it("NEVER reports it as attached — the whole point", async () => {
    // The live run said "2 attached" for files the page had thrown away.
    mountTypedDropzone("image/jpeg,.jpeg,.png,.jpg");
    pdfForAPhotoSlot();
    const res = await fillUploadPage(
      { page_path: "/photo-id/I-131/evidence", kind: "document", doc_type: "passport" },
      CTX,
    );
    expect(res.attached).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  }, 30000);

  it("names the file, its type, and what the slot allows", async () => {
    mountTypedDropzone("image/jpeg,.jpeg,.png,.jpg");
    pdfForAPhotoSlot();
    const res = await fillUploadPage(
      { page_path: "/photo-id/I-131/evidence", kind: "document", doc_type: "passport" },
      CTX,
    );
    const warning = res.warnings.join(" ");
    expect(warning).toContain("passport.pdf");
    expect(warning).toContain("application/pdf");
    expect(warning).toContain("image/jpeg");
    // And NOT "no document on file" — the document exists, the slot refuses it.
    expect(warning).not.toMatch(/upload it in ParaLeagle first/i);
  }, 30000);

  it("still attaches the files the slot DOES take, and reports only the rest", async () => {
    mountTypedDropzone("image/jpeg,.jpeg,.png,.jpg");
    installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "passport",
            file_url: "http://localhost:8001/media/passport.pdf",
            filename: "passport.pdf",
          },
          {
            id: "d2",
            doc_type: "photos",
            file_url: "http://localhost:8001/media/photo.jpg",
            filename: "photo.jpg",
          },
        ]),
      downloadResponder: (url: string) => ({
        success: true,
        dataBase64: btoa("bytes"),
        contentType: url.endsWith(".jpg") || url.includes("/d2/") ? "image/jpeg" : "application/pdf",
      }),
    });
    const res = await fillUploadPageAll(
      [
        { page_path: "/photo-id/I-131/evidence", kind: "document", doc_type: "passport" },
        { page_path: "/photo-id/I-131/evidence", kind: "document", doc_type: "photos" },
      ],
      CTX,
    );
    expect(res.attached).toBe(1);
    expect(res.warnings.join(" ")).toContain("passport.pdf");
  }, 30000);
});

describe("doc-flow: two documents of the same type with no filename", () => {
  it("gives them distinct names so neither is lost to the de-dupe", async () => {
    // FAM-0100 holds two bank statements. The backend sent no filename for either,
    // so both fell back to "bank_statement.pdf". The de-dupe matches on a
    // 12-character stem, so one attached row would make the other look already
    // attached — and the second statement would silently never be filed.
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "aaaaaaaa-1111", doc_type: "bank_statement", file_url: "http://localhost:8001/m/1.pdf" },
          { id: "bbbbbbbb-2222", doc_type: "bank_statement", file_url: "http://localhost:8001/m/2.pdf" },
        ]),
    });
    const res = await fillUploadPage(
      { page_path: "/evidence/proof-of-ability-to-pay", kind: "document", doc_type: "bank_statement" },
      CTX,
    );
    expect(res.attached).toBe(2);
    const names = [...document.querySelectorAll(".uploaded-file")].map((r) => r.textContent);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps the clean name when the type holds only one document", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "aaaaaaaa-1111", doc_type: "i94", file_url: "http://localhost:8001/m/i94.pdf" },
        ]),
    });
    await fillUploadPage(
      { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
      CTX,
    );
    // No gratuitous suffix on the overwhelmingly common single-document case.
    expect(document.querySelector(".uploaded-file")?.textContent).toContain("i94.pdf");
    expect(document.querySelector(".uploaded-file")?.textContent).not.toContain("-aaaaaaaa");
  });
});

describe("doc-flow: an evidence page myUSCIS only identifies by heading", () => {
  const PAGES: UploadPageDescriptor[] = [
    { page_path: "", heading: "Basis of wage level", kind: "document", doc_type: "oflc_dol_printout" },
    { page_path: "/evidence/form-i-94", kind: "document", doc_type: "i94" },
  ];

  it("matches the descriptor whose heading the page carries", () => {
    const all = descriptorsForPage("/forms/x/13359458/evidence/unknown-slug", "Evidence Of The Basis Of Wage Level", PAGES);
    expect(all.map((d) => d.doc_type)).toEqual(["oflc_dol_printout"]);
  });

  it("matches when the live heading is shorter than the declared one", () => {
    const all = descriptorsForPage("/forms/x/1/evidence/anything", "Basis of wage", [
      { page_path: "", heading: "Basis of wage level", kind: "document", doc_type: "oflc_dol_printout" },
    ]);
    expect(all.map((d) => d.doc_type)).toEqual(["oflc_dol_printout"]);
  });

  it("does not attach a heading-only descriptor to every page it walks past", () => {
    const all = descriptorsForPage("/forms/x/13359458/evidence/form-i-94", "Form I-94", PAGES);
    expect(all.map((d) => d.doc_type)).toEqual(["i94"]);
  });

  it("does not treat a generic heading as a match for a specific one", () => {
    // "Evidence" is a substring of "Degree or evidence of specialized training".
    // Matching on it would attach the education documents to any page whose first
    // heading happens to be the section title.
    const all = descriptorsForPage("/forms/x/1/evidence/something", "Evidence", [
      { page_path: "", heading: "Degree or evidence of specialized training", kind: "document", doc_type: "marksheet" },
    ]);
    expect(all).toEqual([]);
  });

  it("still matches on page_path when the page has no heading at all", () => {
    const all = descriptorsForPage("/forms/x/13359458/evidence/form-i-94", "", PAGES);
    expect(all.map((d) => d.doc_type)).toEqual(["i94"]);
  });
});

// ===========================================================================
// FALLBACK FILENAMES THAT SURVIVE A RE-RUN
//
// The backend sends no filename, so a row is named after its doc_type. The
// de-dupe that keeps a re-run from attaching a file twice compares the first 12
// characters of the name (myUSCIS truncates long names in its file list). With
// the old suffix scheme, "divorce_decree-<id>" and "divorce_decree-<other id>"
// share those 12 characters — so once ONE decree was on the page, every other
// decree of the case read as "already attached" and was silently left out of
// the filing. The same collision took a green card's back for its front
// whenever the two ids happened to start with the same character.
//
// The name has to be decided per DOCUMENT, not per listing: the earliest
// document keeps the clean name, any later one carries its id up front where
// the 12-character window can see it, and a two-sided card is named by side.
// ===========================================================================
describe("doc-flow: fallback filenames that survive a re-run", () => {
  const MARRIAGE_SLOT: UploadPageDescriptor = {
    page_path: "/evidence/current-marriage-certificate-and-previous-marriage-documents",
    kind: "document",
    doc_type: "divorce_decree",
  };
  const DECREE_A = {
    id: "a1111111-0000-4000-8000-000000000001",
    doc_type: "divorce_decree",
    file_url: "http://localhost:8001/m/decree-a.pdf",
    created: "2026-08-01T10:00:00Z",
  };
  const DECREE_B = {
    id: "b2222222-0000-4000-8000-000000000002",
    doc_type: "divorce_decree",
    file_url: "http://localhost:8001/m/decree-b.pdf",
    created: "2026-08-02T10:00:00Z",
  };
  const rowNames = (): string[] =>
    [...document.querySelectorAll(".uploaded-file")].map((r) => r.textContent ?? "");

  it("uploads a decree added after the first went up, instead of taking it for the first", async () => {
    installProxy({ apiResponder: () => apiOk([DECREE_A]) });
    expect((await fillUploadPage(MARRIAGE_SLOT, CTX)).attached).toBe(1);

    // The client uploads a second decree in ParaLeagle; the caseworker re-runs.
    installProxy({ apiResponder: () => apiOk([DECREE_A, DECREE_B]) });
    const again = await fillUploadPage(MARRIAGE_SLOT, CTX);
    expect(again.attached, "the second decree was mistaken for the first").toBe(1);
    expect(again.alreadyAttached).toBe(1);
    expect(rowNames().length).toBe(2);
    // The first keeps its clean name; the newcomer carries its id where the
    // 12-character window can see it.
    expect(rowNames().some((n) => n.includes("divorce_decree.pdf"))).toBe(true);
    expect(rowNames().some((n) => n.includes("b2222222-divorce_decree.pdf"))).toBe(true);
  });

  it("finishes a slot that a failed run left half done", async () => {
    installProxy({ apiResponder: () => apiOk([DECREE_A, DECREE_B]) });
    expect((await fillUploadPage(MARRIAGE_SLOT, CTX)).attached).toBe(2);
    // myUSCIS refused the second file: its row is gone, the first's stays.
    const rows = [...document.querySelectorAll(".uploaded-file")];
    const second = rows.find((r) => r.textContent?.includes("b2222222"));
    expect(second).toBeDefined();
    second!.remove();

    const again = await fillUploadPage(MARRIAGE_SLOT, CTX);
    expect(again.attached, "the missing decree was not retried").toBe(1);
    expect(again.alreadyAttached).toBe(1);
  });

  it("names the two sides of a card by side, so the back is never taken for the front", async () => {
    // Both ids start with "a": under the old scheme both names began
    // "green_card-a", so the back read as already attached once the front was.
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "a1111111-0000-4000-8000-000000000001", doc_type: "green_card", part: "front", file_url: "http://localhost:8001/m/gc-front.pdf" },
          { id: "a3333333-0000-4000-8000-000000000003", doc_type: "green_card", part: "back", file_url: "http://localhost:8001/m/gc-back.pdf" },
        ]),
    });
    const slot: UploadPageDescriptor = {
      page_path: "/evidence/your-permanent-resident-card",
      kind: "document",
      doc_type: "green_card",
    };
    const first = await fillUploadPage(slot, CTX);
    expect(first.attached).toBe(2);
    expect(rowNames().some((n) => n.includes("green_card-front.pdf"))).toBe(true);
    expect(rowNames().some((n) => n.includes("green_card-back.pdf"))).toBe(true);

    // A partial re-run: the back's row is gone, the front's stays.
    [...document.querySelectorAll(".uploaded-file")]
      .find((r) => r.textContent?.includes("back"))!
      .remove();
    const again = await fillUploadPage(slot, CTX);
    expect(again.attached, "the back was taken for the front").toBe(1);
    expect(again.alreadyAttached).toBe(1);
  });
});

// ===========================================================================
// DOCUMENTS WHOSE OWN EVIDENCE PAGE myUSCIS NEVER SHOWED
//
// A document routed to a dedicated evidence page leaves the Additional-evidence
// catch-all (the backend expands the catch-all into every doc_type WITHOUT a
// dedicated slot). But myUSCIS renders some evidence pages only for some
// answers: the N-400's child-and-spousal-support page appears only for a
// Married applicant, and its crime pages only once an arrest is answered. A
// divorced applicant's support order is therefore routed to a page the walk
// never lands on, and reaches USCIS nowhere — silently, because "not visited"
// looks exactly like "nothing to do".
//
// The catch-all page is the one place that can still take it, and it is the
// last evidence page of the walk, so by the time the walk gets there it KNOWS
// which earlier upload pages never rendered.
// ===========================================================================
describe("doc-flow: documents whose own evidence page myUSCIS never showed", () => {
  const upload = (slug: string, extra: Partial<FormPage> = {}): FormPage => ({
    slug,
    title: slug,
    kind: "upload",
    fields: [],
    ...extra,
  });
  const PAGES: FormPage[] = [
    { slug: "/about-you/your-name", title: "Your name", kind: "form", fields: [] },
    upload("/evidence/your-permanent-resident-card"),
    upload("/evidence/child-and-spousal-support", { conditional: true }),
    upload("/evidence/additional-evidence", { catchAll: true }),
    upload("/evidence/declared-after-the-catch-all"),
  ];
  const DECLARED = PAGES.filter((p) => p.kind === "upload").map((p) => p.slug);
  const UPLOADS: UploadPageDescriptor[] = [
    { page_path: "/evidence/your-permanent-resident-card", kind: "document", doc_type: "green_card" },
    { page_path: "/evidence/child-and-spousal-support", kind: "document", doc_type: "child_support_order" },
    { page_path: "/evidence/child-and-spousal-support", kind: "document", doc_type: "child_birth_certificate" },
    { page_path: "/evidence/additional-evidence", kind: "document", doc_type: "tax_transcript" },
    // A slot the backend routes but no descriptor page declares (an undeclared
    // slug never matches, so its document would otherwise go nowhere).
    { page_path: "/evidence/ds-2019", kind: "document", doc_type: "form_ds2019" },
    // Heading-only (I-129 style): no path to be "unvisited" by.
    { page_path: "", heading: "Basis of wage level", kind: "document", doc_type: "oflc_printout" },
  ];

  it("lists the upload pages declared before this one that the walk never reached", () => {
    const visited = new Set(["/about-you/your-name", "/evidence/your-permanent-resident-card"]);
    expect(unvisitedUploadSlugsBefore(PAGES, "/evidence/additional-evidence", visited)).toEqual([
      "/evidence/child-and-spousal-support",
    ]);
  });

  it("does not count a page declared after this one — it may still render", () => {
    const none = unvisitedUploadSlugsBefore(PAGES, "/evidence/additional-evidence", new Set(DECLARED));
    expect(none).toEqual([]);
    const all = unvisitedUploadSlugsBefore(PAGES, "/evidence/additional-evidence", new Set());
    expect(all).not.toContain("/evidence/declared-after-the-catch-all");
    expect(all).not.toContain("/about-you/your-name");
  });

  it("picks up the documents of an unrendered page on the catch-all", () => {
    const strays = strayDescriptors(UPLOADS, "/evidence/additional-evidence", {
      unvisitedUploadSlugs: ["/evidence/child-and-spousal-support"],
      declaredUploadSlugs: DECLARED,
    });
    expect(strays.map((d) => d.doc_type)).toEqual([
      "child_support_order",
      "child_birth_certificate",
      "form_ds2019",
    ]);
  });

  it("leaves alone a page the walk did fill", () => {
    const strays = strayDescriptors(UPLOADS, "/evidence/additional-evidence", {
      unvisitedUploadSlugs: [],
      declaredUploadSlugs: DECLARED,
    });
    // Only the slot no page declares is left over; the support documents went
    // up on their own page.
    expect(strays.map((d) => d.doc_type)).toEqual(["form_ds2019"]);
  });

  it("never treats the catch-all's own slot, or a heading-only slot, as a stray", () => {
    const strays = strayDescriptors(UPLOADS, "/evidence/additional-evidence", {
      unvisitedUploadSlugs: DECLARED.filter((s) => s !== "/evidence/additional-evidence"),
      declaredUploadSlugs: DECLARED,
    });
    expect(strays.map((d) => d.doc_type)).not.toContain("tax_transcript");
    expect(strays.map((d) => d.doc_type)).not.toContain("oflc_printout");
  });

  it("attaches the strays alongside the catch-all's own documents", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "d1", doc_type: "tax_transcript", file_url: "http://localhost:8001/m/tax.pdf" },
          { id: "d2", doc_type: "child_support_order", file_url: "http://localhost:8001/m/support.pdf" },
        ]),
    });
    const own = descriptorsForPath("/evidence/additional-evidence", UPLOADS);
    const strays = strayDescriptors(UPLOADS, "/evidence/additional-evidence", {
      unvisitedUploadSlugs: ["/evidence/child-and-spousal-support"],
      declaredUploadSlugs: DECLARED,
    });
    const res = await fillUploadPageAll([...own, ...strays], CTX);
    expect(res.attached).toBe(2);
  });
});

// ===========================================================================
// A STRAY IS MATCHED BY PATH SEGMENT, NOT A SHARED TRAILING WORD
//
// samePage compares a declared/visited slug against a descriptor's page_path.
// A bare-suffix compare (`a.endsWith(b) || b.endsWith(a)`) treats a page whose
// slug merely ENDS with the same word as "the same page": a visited
// ".../child-and-spousal-support" swallows a distinct, undeclared slot whose
// page_path is "support", and its document is silently dropped — exactly the
// failure this catch-all rescue exists to prevent. The match must align on a
// path-segment boundary.
// ===========================================================================
describe("doc-flow: a stray is matched by path segment, not a shared word", () => {
  const UPLOADS: UploadPageDescriptor[] = [
    { page_path: "/evidence/child-and-spousal-support", kind: "document", doc_type: "child_support_order" },
    // A different slot no page declares; its bare page_path only shares the
    // trailing word "support" with the visited page above.
    { page_path: "support", kind: "document", doc_type: "affidavit_of_support" },
  ];
  const DECLARED = ["/evidence/child-and-spousal-support", "/evidence/additional-evidence"];

  it("does not drop an undeclared slot that only shares a trailing word with a visited page", () => {
    const strays = strayDescriptors(UPLOADS, "/evidence/additional-evidence", {
      unvisitedUploadSlugs: [],
      declaredUploadSlugs: DECLARED,
    });
    // The undeclared "support" slot has no page of its own — it belongs on the
    // catch-all. The visited child-and-spousal-support slot does not.
    expect(strays.map((d) => d.doc_type)).toContain("affidavit_of_support");
    expect(strays.map((d) => d.doc_type)).not.toContain("child_support_order");
  });

  it("still treats a relative page_path as the same page when it aligns on a boundary", () => {
    // The legitimate use of the loose match: a page_path stored without its
    // leading directory ("evidence/marriage") is the same page as the full
    // visited slug ("/n400/evidence/marriage"), so its slot is NOT a stray.
    const uploads: UploadPageDescriptor[] = [
      { page_path: "evidence/marriage", kind: "document", doc_type: "marriage_certificate" },
    ];
    const strays = strayDescriptors(uploads, "/n400/evidence/additional-evidence", {
      unvisitedUploadSlugs: [],
      declaredUploadSlugs: ["/n400/evidence/marriage", "/n400/evidence/additional-evidence"],
    });
    expect(strays.map((d) => d.doc_type)).not.toContain("marriage_certificate");
  });
});

// ===========================================================================
// UPLOAD-READY FILES FROM THE USCIS-FILE ENDPOINTS
//
// The backend prepares every file for USCIS: compressed under 12 MB, a name made
// of the characters USCIS allows (in Content-Disposition), and signed when it is
// a generated form. The raw file_url is the ORIGINAL, which may be none of those.
// ===========================================================================

const API = "http://localhost:8001/api/v1";

const rowNames = (): string[] =>
  [...document.querySelectorAll(".uploaded-file span")].map((r) => r.textContent ?? "");

const downloadUrls = (sendMessage: any): string[] =>
  sendMessage.mock.calls
    .map((c: any[]) => c[0])
    .filter((m: any) => m.type === "DOWNLOAD_FILE")
    .map((m: any) => m.url);

/** A proxy answer carrying the backend's prepared name. */
const prepared = (filename: string, contentType = "application/pdf"): unknown => ({
  success: true,
  dataBase64: PDF_BASE64,
  contentType,
  contentDisposition: `attachment; filename="${filename}"`,
});

describe("doc-flow: files come from the uscis-file endpoints", () => {
  const OFFER = {
    id: "d1",
    doc_type: "offer_letter",
    file_url: "http://localhost:8001/media/raw-offer.pdf",
    filename: "raw-offer.pdf",
  };
  const OFFER_SLOT: UploadPageDescriptor = {
    page_path: "/additional-evidence/I-485J/evidence",
    kind: "document",
    doc_type: "offer_letter",
  };

  it("downloads a document from /documents/<id>/uscis-file/, not its file_url", async () => {
    const sendMessage = installProxy({
      apiResponder: () => apiOk([OFFER]),
      downloadResponder: () => prepared("Offer Letter (Acme).pdf"),
    });
    const res = await fillUploadPage(OFFER_SLOT, CTX);
    expect(res.attached).toBe(1);
    expect(downloadUrls(sendMessage)).toEqual([`${API}/documents/d1/uscis-file/`]);
  });

  it("downloads a generated form from /forms/generated/<id>/uscis-file/", async () => {
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([
          { id: "g1", form_type: "I-485J", version: 1, file_url: "http://localhost:8001/media/j1.pdf" },
          { id: "g2", form_type: "I-485J", version: 2, file_url: "http://localhost:8001/media/j2.pdf" },
        ]),
      downloadResponder: () => prepared("Form I-485J (signed).pdf"),
    });
    const res = await fillUploadPage(
      { page_path: "/form", kind: "generated_form", form_type: "I-485J" },
      CTX,
    );
    expect(res.attached).toBe(1);
    expect(downloadUrls(sendMessage)).toEqual([`${API}/forms/generated/g2/uscis-file/`]);
  });

  it("names a document after its Content-Disposition, not the listing", async () => {
    installProxy({
      apiResponder: () => apiOk([OFFER]),
      downloadResponder: () => prepared("Offer Letter (Acme).pdf"),
    });
    await fillUploadPage(OFFER_SLOT, CTX);
    expect(rowNames()).toEqual(["Offer Letter (Acme).pdf"]);
  });

  it("names a generated form after its Content-Disposition", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([{ id: "g2", form_type: "G-28-BEN", version: 1, file_url: "http://localhost:8001/media/g28.pdf" }]),
      downloadResponder: () => prepared("G-28 applicant (signed).pdf"),
    });
    await fillUploadPage({ page_path: "/form-g28", kind: "generated_form", form_type: "G-28-BEN" }, CTX);
    expect(rowNames()).toEqual(["G-28 applicant (signed).pdf"]);
  });

  it("decodes an RFC 5987 filename* parameter", async () => {
    installProxy({
      apiResponder: () => apiOk([OFFER]),
      downloadResponder: () => ({
        success: true,
        dataBase64: PDF_BASE64,
        contentType: "application/pdf",
        contentDisposition: "attachment; filename*=UTF-8''Offer%20Letter%20%28Acme%29.pdf",
      }),
    });
    await fillUploadPage(OFFER_SLOT, CTX);
    expect(rowNames()).toEqual(["Offer Letter (Acme).pdf"]);
  });

  it("attaches the prepared name once, however many times the page is filled", async () => {
    installProxy({
      apiResponder: () => apiOk([OFFER]),
      downloadResponder: () => prepared("Offer Letter (Acme).pdf"),
    });
    await fillUploadPage(OFFER_SLOT, CTX);
    const again = await fillUploadPage(OFFER_SLOT, CTX);
    expect(again.attached).toBe(0);
    expect(rowNames()).toEqual(["Offer Letter (Acme).pdf"]);
  });

  it("still fetches a document the listing says is too big, since the endpoint compresses it", async () => {
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([{ ...OFFER, size_bytes: 36_278_893, too_big_for_uscis: true }]),
      downloadResponder: () => prepared("Offer Letter (Acme).pdf"),
    });
    const res = await fillUploadPage(OFFER_SLOT, CTX);
    expect(downloadUrls(sendMessage)).toEqual([`${API}/documents/d1/uscis-file/`]);
    expect(res.attached).toBe(1);
    expect(res.warnings).toEqual([]);
  });
});

// ===========================================================================
// A NAME FOR A FILE THE BACKEND DID NOT NAME
//
// USCIS takes PDF, JPG, PNG and TIF, and names made of letters, digits, space,
// period, hyphen, underscore and parentheses. The extension must follow the
// file's real type: a JPEG uploaded as "<doc_type>.pdf" is a mislabelled file.
// ===========================================================================

describe("doc-flow: fallback names follow the file's type and USCIS's character set", () => {
  const SLOT: UploadPageDescriptor = {
    page_path: "/additional-evidence/I-485J/evidence",
    kind: "document",
    doc_type: "offer_letter",
  };
  const unnamed = (extra: Record<string, unknown> = {}) => ({
    id: "a1111111-0000-4000-8000-000000000001",
    doc_type: "offer_letter",
    file_url: "http://localhost:8001/m/offer",
    created: "2026-08-01T10:00:00Z",
    ...extra,
  });

  it.each([
    ["image/jpeg", "offer_letter.jpg"],
    ["image/png", "offer_letter.png"],
    ["image/tiff", "offer_letter.tif"],
  ])("names a %s document %s", async (contentType, expected) => {
    installProxy({
      apiResponder: () => apiOk([unnamed()]),
      downloadResponder: () => ({ success: true, dataBase64: PDF_BASE64, contentType }),
    });
    const res = await fillUploadPage(SLOT, CTX);
    expect(res.attached).toBe(1);
    expect(rowNames()).toEqual([expected]);
  });

  it("keeps the side and the id prefix, and still follows the type", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          unnamed({ part: "front" }),
          unnamed({ id: "b2222222-0000-4000-8000-000000000002", created: "2026-08-02T10:00:00Z" }),
        ]),
      downloadResponder: () => ({ success: true, dataBase64: PDF_BASE64, contentType: "image/png" }),
    });
    await fillUploadPage(SLOT, CTX);
    expect(rowNames()).toEqual(["offer_letter-front.png", "b2222222-offer_letter.png"]);
  });

  it("never attaches a type USCIS does not take, and never calls it a .pdf", async () => {
    installProxy({
      apiResponder: () => apiOk([unnamed()]),
      downloadResponder: () => ({
        success: true,
        dataBase64: PDF_BASE64,
        contentType: "application/msword",
      }),
    });
    const res = await fillUploadPage(SLOT, CTX);
    expect(res.attached).toBe(0);
    expect(rowNames()).toEqual([]);
    expect(res.warnings.join(" ")).toContain("application/msword");
    expect(res.warnings.join(" ")).not.toMatch(/offer_letter\.pdf/);
  });

  it("reduces a listing name and a Content-Disposition name to the characters USCIS allows", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          unnamed({ filename: "Offer letter: Acme/Inc #2 [final].pdf" }),
          unnamed({ id: "c3333333", doc_type: "i485j_cover_letter", file_url: "http://localhost:8001/m/cover" }),
        ]),
      downloadResponder: (url: string) =>
        url.includes("c3333333") || url.endsWith("/m/cover")
          ? prepared("Cover*Letter?<J>.pdf")
          : { success: true, dataBase64: PDF_BASE64, contentType: "application/pdf" },
    });
    const res = await fillUploadPageAll([SLOT, { ...SLOT, doc_type: "i485j_cover_letter" }], CTX);
    expect(res.attached).toBe(2);
    const names = rowNames();
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name, name).toMatch(USCIS_FILENAME);
      expect(name.endsWith(".pdf"), name).toBe(true);
    }
  });
});

// ===========================================================================
// I-485J ADDITIONAL EVIDENCE
//
// The order is the backend's decision: cover letter, I-485 receipt, I-140,
// offer letter, PERM, transfer or prior Supplement J receipt. The extension
// keeps it, across generated and document entries and across the 5-file batch,
// and steps over any slot the case has nothing for. The page is NOT a catch-all,
// so the Supplement J and the G-28 can never stray onto it.
// ===========================================================================

const AE_LIVE = new URL(`${I485J_BASE}${I485J_SLUGS.additionalEvidence}`).pathname;

// Listed out of the backend's slot order, so following the listing shows. Each
// listing filename differs from the prepared name, so a de-dupe on the listing
// name cannot pass for one on the Content-Disposition name.
const I485J_DOCS = [
  { id: "d-xfer1", doc_type: "i485_transfer_or_prior_supj_receipt", created: "2026-09-02T00:00:00Z" },
  { id: "d-i140", doc_type: "i140", created: "2026-09-03T00:00:00Z" },
  { id: "d-sj", doc_type: "i485j_signed", created: "2026-09-03T00:00:00Z" },
  { id: "d-xfer2", doc_type: "i485_transfer_or_prior_supj_receipt", created: "2026-09-04T00:00:00Z" },
  { id: "d-g28", doc_type: "g28_applicant_signed", created: "2026-09-03T00:00:00Z" },
  { id: "d-rcpt", doc_type: "i485_receipt_notice", created: "2026-09-01T00:00:00Z" },
  { id: "d-xfer3", doc_type: "i485_transfer_or_prior_supj_receipt", created: "2026-09-05T00:00:00Z" },
].map((d) => ({ ...d, file_url: `http://localhost:8001/m/${d.id}`, filename: `scan-${d.id}.pdf` }));

const I485J_GENERATED = [
  { id: "g-cover", form_type: "COVER_LETTER_I-485J" },
  { id: "g-j", form_type: "I-485J" },
  { id: "g-g28", form_type: "G-28-BEN" },
].map((g) => ({ ...g, version: 1, file_url: `http://localhost:8001/m/${g.id}` }));

const I485J_PREPARED: Record<string, string> = {
  "g-cover": "Cover letter.pdf",
  "d-rcpt": "I-485 receipt.pdf",
  "d-i140": "I-140 approval.pdf",
  "d-xfer1": "Transfer notice 1.pdf",
  "d-xfer2": "Transfer notice 2.pdf",
  "d-xfer3": "Prior Supplement J receipt.pdf",
  "d-sj": "Supplement J signed.pdf",
  "d-g28": "G-28 applicant signed.pdf",
  "g-j": "Form I-485J.pdf",
  "g-g28": "Form G-28.pdf",
};

const EVIDENCE_IN_ORDER = [
  "Cover letter.pdf",
  "I-485 receipt.pdf",
  "I-140 approval.pdf",
  "Transfer notice 1.pdf",
  "Transfer notice 2.pdf",
  "Prior Supplement J receipt.pdf",
];

function installI485jCase(): any {
  return installProxy({
    apiResponder: (path) => {
      if (!path.startsWith("/forms/generated/")) return apiOk(I485J_DOCS);
      const formType = new URLSearchParams(path.split("?")[1]).get("form_type");
      return apiOk(I485J_GENERATED.filter((g) => g.form_type === formType));
    },
    downloadResponder: (url) => {
      const id = Object.keys(I485J_PREPARED).find((k) => url.includes(`/${k}/`));
      return id ? prepared(I485J_PREPARED[id]) : { success: false, error: `unexpected download ${url}` };
    },
  });
}

describe("doc-flow: I-485J additional evidence keeps the backend's order", () => {
  it("downloads and attaches in the backend's order, across the 5-file batch", async () => {
    const sendMessage = installI485jCase();
    const own = descriptorsForPage(AE_LIVE, "", I485J_UPLOAD_PAGES);
    expect(own.map((d) => d.doc_type ?? d.form_type)).toEqual([
      "COVER_LETTER_I-485J",
      "i485_receipt_notice",
      "i140",
      "offer_letter",
      "perm_labor_certification",
      "i485_transfer_or_prior_supj_receipt",
    ]);
    const res = await fillUploadPageAll(own, CTX);
    expect(res.attached).toBe(6);
    expect(downloadUrls(sendMessage)).toEqual([
      `${API}/forms/generated/g-cover/uscis-file/`,
      `${API}/documents/d-rcpt/uscis-file/`,
      `${API}/documents/d-i140/uscis-file/`,
      `${API}/documents/d-xfer1/uscis-file/`,
      `${API}/documents/d-xfer2/uscis-file/`,
      `${API}/documents/d-xfer3/uscis-file/`,
    ]);
    expect(rowNames()).toEqual(EVIDENCE_IN_ORDER);
  }, 30000);

  it("steps over the slots the case has nothing for, without a warning", async () => {
    installI485jCase();
    const res = await fillUploadPageAll(descriptorsForPage(AE_LIVE, "", I485J_UPLOAD_PAGES), CTX);
    expect(res.attached).toBe(6);
    expect(res.warnings).toEqual([]);
  }, 30000);
});

describe("fillAll + doc-flow: an I-485J Fill all started on Additional Evidence", () => {
  function i485jConfig(): FormConfig {
    const config = configForFormType("I-485J");
    expect(config, "no I-485J config registered").not.toBeNull();
    return config!;
  }

  function goToUrl(url: string): void {
    (window.location as unknown as { href: string }).href = url;
  }

  /** The dropzone plus a Next that moves to review and leaves the rows in place. */
  function mountAdditionalEvidence(): void {
    goToUrl(`${I485J_BASE}${I485J_SLUGS.additionalEvidence}`);
    mountDropzone();
    const next = document.createElement("button");
    next.setAttribute("data-testid", "next-btn");
    next.textContent = "Next";
    next.addEventListener("click", () => goToUrl(`${I485J_BASE}${I485J_SLUGS.review}`));
    document.body.appendChild(next);
  }

  /** The content script's upload step, composed from the same exported pieces. */
  function uploadStep(results: { attached: number; alreadyAttached: number }[]) {
    return async (page: FormPage, walk: UploadWalkContext): Promise<number> => {
      const own = descriptorsForPage(page.slug, "", I485J_UPLOAD_PAGES);
      const strays = page.catchAll ? strayDescriptors(I485J_UPLOAD_PAGES, page.slug, walk) : [];
      const res = await fillUploadPageAll([...own, ...strays], CTX);
      results.push(res);
      return res.attached + res.alreadyAttached;
    };
  }

  it("does not make Additional Evidence a catch-all", () => {
    const page = i485jConfig().pages.find((p) => p.slug === I485J_SLUGS.additionalEvidence);
    expect(page, "Additional Evidence is not declared").toBeDefined();
    expect(page!.catchAll ?? false).toBe(false);
  });

  it("attaches only the six evidence entries, never the Supplement J or the G-28", async () => {
    const config = i485jConfig();
    const sendMessage = installI485jCase();
    mountAdditionalEvidence();

    await fillAll(config, {}, uploadStep([]));

    expect(rowNames()).toEqual(EVIDENCE_IN_ORDER);
    const urls = downloadUrls(sendMessage).join(" ");
    for (const id of ["d-sj", "d-g28", "g-j", "g-g28"]) expect(urls, id).not.toContain(`/${id}/`);
  }, 60000);

  it("attaches nothing new on a second Fill all, matching on the prepared name", async () => {
    const config = i485jConfig();
    installI485jCase();
    mountAdditionalEvidence();
    const first: { attached: number; alreadyAttached: number }[] = [];
    await fillAll(config, {}, uploadStep(first));
    expect(first.map((r) => r.attached)).toEqual([6]);

    goToUrl(`${I485J_BASE}${I485J_SLUGS.additionalEvidence}`);
    const second: { attached: number; alreadyAttached: number }[] = [];
    await fillAll(config, {}, uploadStep(second));

    expect(second).toMatchObject([{ attached: 0, alreadyAttached: 6 }]);
    expect(rowNames()).toEqual(EVIDENCE_IN_ORDER);
  }, 60000);
});
