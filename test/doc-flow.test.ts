import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fillUploadPage, fillUploadPageAll, descriptorsForPath } from "../src/runner/doc-flow";
import type { UploadPageDescriptor } from "../src/runner/payload";

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
      url: "http://localhost:8001/media/i130a_v2.pdf",
    });
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
    expect(downloads[0].url).toBe("http://localhost:8001/media/marriage.pdf");
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
    expect(downloads[0].url).toBe("http://localhost:8001/media/app.jpg");
  });

  it("attaches what resolved and still reports the file that failed", async () => {
    installProxy({
      apiResponder: () =>
        apiOk([
          { id: "p1", doc_type: "photos", file_url: "http://localhost:8001/media/ok.jpg", filename: "ok.jpg" },
          { id: "p2", doc_type: "photos", file_url: "http://localhost:8001/media/bad.jpg", filename: "bad.jpg" },
        ]),
      downloadResponder: (url) =>
        url.endsWith("bad.jpg")
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

  it("does not download at all when the listing already says it is too big", async () => {
    // The backend now sends size_bytes / too_big_for_uscis, so the decision moves
    // to the LISTING. Transferring 34.6 MB through the message channel only to
    // discard it is pure waste, and the run is slow enough already.
    const sendMessage = installProxy({
      apiResponder: () =>
        apiOk([
          {
            id: "d1",
            doc_type: "form_i20",
            file_url: "http://localhost:8001/media/form_i20.pdf",
            filename: "form_i20.pdf",
            size_bytes: 36_278_893,
            too_big_for_uscis: true,
          },
        ]),
    });
    const res = await fillUploadPage(
      { page_path: "/evidence/form-I-20", kind: "document", doc_type: "form_i20" },
      CTX,
    );
    expect(res.attached).toBe(0);
    expect(res.warnings.join(" ")).toContain("34.6 MB");
    // The whole point: no bytes were ever asked for.
    const downloads = sendMessage.mock.calls.filter(
      (c: any[]) => c[0]?.type === "DOWNLOAD_FILE",
    );
    expect(downloads.length).toBe(0);
  });

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
