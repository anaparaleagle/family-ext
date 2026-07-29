import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fillUploadPage } from "../src/runner/doc-flow";
import type { UploadPageDescriptor } from "../src/runner/payload";

const CTX = {
  apiBaseUrl: "http://localhost:8001/api/v1",
  accessToken: "tok",
  caseId: "case-123",
};

/** Minimal dropzone so engine/doc-uploader.attachFiles has an input + a way to
 * acknowledge the upload (a Remove control appears after inject). */
function mountDropzone(): void {
  document.body.innerHTML =
    '<div class="dropzone"><input type="file" id="desktop-drop" /></div>';
  const input = document.getElementById("desktop-drop") as HTMLInputElement;
  // Simulate myUSCIS accepting the drop: render a Remove control on change so
  // the count-delta wait resolves immediately.
  input.addEventListener("change", () => {
    if (!document.querySelector("button.remove")) {
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "Remove";
      document.body.appendChild(btn);
    }
  });
}

/** Bytes the fake proxy hands back for any DOWNLOAD_FILE. */
const PDF_BYTES = [37, 80, 68]; // "%PD"

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
      return { success: true, data: PDF_BYTES, contentType: "application/pdf" };
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
          : { success: true, data: PDF_BYTES, contentType: "image/jpeg" },
    });
    const res = await fillUploadPage(
      { page_path: "/evidences/photo-of-spouse", kind: "document", doc_type: "photos" },
      CTX,
    );
    expect(res.attached).toBe(1);
    expect(res.warnings.join(" ")).toMatch(/bad\.jpg/);
  });
});
