import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fillUploadPage } from "../src/runner/doc-flow";
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
      if (attachedRowFor(file.name)) continue; // myUSCIS lists each file once
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

function attachedRowFor(filename: string): Element | undefined {
  return Array.from(document.querySelectorAll(".uploaded-file")).find((r) =>
    (r.textContent || "").includes(filename),
  );
}

beforeEach(() => {
  mountDropzone();
  // Background proxy: return 3 bytes for any DOWNLOAD_FILE message.
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: vi.fn(async () => ({
        success: true,
        data: [37, 80, 68], // "%PD"
        contentType: "application/pdf",
      })),
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("doc-flow: generated_form (I-130A) resolution", () => {
  it("hits GET /forms/generated/?case=<id> and attaches the latest I-130A file", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "http://localhost:8001/api/v1/forms/generated/?case=case-123&form_type=I-130A",
      );
      return {
        ok: true,
        json: async () => ({
          results: [
            { id: "g1", form_type: "I-130A", version: 1, file_url: "http://localhost:8001/media/i130a_v1.pdf" },
            { id: "g2", form_type: "I-130A", version: 2, file_url: "http://localhost:8001/media/i130a_v2.pdf" },
            { id: "g3", form_type: "I-130", version: 1, file_url: "http://localhost:8001/media/i130.pdf" },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/i130a-supplimental-information-for-spouse-beneficiary",
      kind: "generated_form",
      form_type: "I-130A",
    };

    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);

    // It downloaded the LATEST (version 2) file_url via the proxy, not v1 or the I-130.
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: "DOWNLOAD_FILE",
      url: "http://localhost:8001/media/i130a_v2.pdf",
    });
  });

  it("warns (no attach) when no generated form of that type is on file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("http://localhost:8001/api/v1/documents/?case=case-123");
        return {
          ok: true,
          json: async () => ({
            results: [
              { id: "d1", doc_type: "marriage_certificate", file_url: "http://localhost:8001/media/marriage.pdf", filename: "marriage.pdf" },
              { id: "d2", doc_type: "photos", file_url: "http://localhost:8001/media/photo.jpg" },
            ],
          }),
        } as Response;
      }),
    );

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/proof-of-marriage",
      kind: "document",
      doc_type: "marriage_certificate",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage.mock.calls[0][0].url).toBe("http://localhost:8001/media/marriage.pdf");
  });

  it("warns the user to upload in ParaLeagle when no document matches", async () => {
    // SOF-892: a required evidence page with no matching document was a
    // near-silent no-op ("No file resolved for …"). The warning must instead be
    // user-facing and actionable — name the missing doc and point at ParaLeagle.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            { id: "p1", doc_type: "photos", party: "PETITIONER", file_url: "http://localhost:8001/media/pet.jpg" },
            { id: "p2", doc_type: "photos", party: "APPLICANT", file_url: "http://localhost:8001/media/app.jpg" },
          ],
        }),
      }) as Response),
    );

    const descriptor: UploadPageDescriptor = {
      page_path: "/evidences/photo-of-spouse",
      kind: "document",
      doc_type: "photos",
      party: "APPLICANT",
    };
    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1);
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage.mock.calls[0][0].url).toBe("http://localhost:8001/media/app.jpg");
  });
});

describe("doc-flow: a document uploads to USCIS exactly once (SOF-1005)", () => {
  const descriptor: UploadPageDescriptor = {
    page_path: "/evidences/proof-of-marriage",
    kind: "document",
    doc_type: "marriage_certificate",
  };

  function stubOneDocument(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              id: "d1",
              doc_type: "marriage_certificate",
              file_url: "http://localhost:8001/media/marriage.pdf",
              filename: "marriage.pdf",
            },
          ],
        }),
      }) as Response),
    );
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
    stubOneDocument();
    await fillUploadPage(descriptor, CTX);
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    const downloadsAfterFirst = sendMessage.mock.calls.length;

    await fillUploadPage(descriptor, CTX);
    expect(sendMessage.mock.calls.length).toBe(downloadsAfterFirst);
  });

  it("still attaches a genuinely new file when one is already on the page", async () => {
    // The de-dupe must be per-FILE, not "page already has something" — otherwise
    // a second evidence document on a multi-file slot would be dropped.
    stubOneDocument();
    await fillUploadPage(descriptor, CTX);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              id: "d1",
              doc_type: "marriage_certificate",
              file_url: "http://localhost:8001/media/marriage.pdf",
              filename: "marriage.pdf",
            },
            {
              id: "d2",
              doc_type: "marriage_certificate",
              file_url: "http://localhost:8001/media/marriage_page2.pdf",
              filename: "marriage_page2.pdf",
            },
          ],
        }),
      }) as Response),
    );

    const res = await fillUploadPage(descriptor, CTX);
    expect(res.attached).toBe(1); // the new one
    expect(res.alreadyAttached).toBe(1); // the one already there
    expect(document.querySelectorAll(".uploaded-file").length).toBe(2);
  });
});
