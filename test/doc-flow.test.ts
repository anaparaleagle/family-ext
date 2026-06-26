import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fillUploadPage } from "../src/i130/doc-flow";
import type { UploadPageDescriptor } from "../src/i130/payload";

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
