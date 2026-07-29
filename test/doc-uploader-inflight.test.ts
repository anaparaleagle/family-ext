/**
 * An upload STILL IN FLIGHT is already attached — do not send it again.
 *
 * THE INCIDENT (2026-07-29, FAM-0100). The I-20 was attached, its upload had not
 * finished, and a second Fill all sent it AGAIN. myUSCIS ended up listing
 * form_i20.pdf twice and then raised its own modal:
 *
 *     "Your files will not upload if you leave this page.
 *      Your files have not finished uploading."
 *
 * Cause, visible in the Action column of that screenshot: a row whose upload is
 * still running offers **Cancel**, not Remove. `removeControls()` matched only
 * remove / delete / remove file / delete file, so an in-flight row was invisible
 * to the SOF-1005 de-dupe, invisible to the "page has files" count, and invisible
 * to the settle-before-Next wait. All three failures come from the same blind spot.
 *
 * Duplicate evidence in a USCIS filing is the thing SOF-1005 exists to prevent, so
 * this is locked here rather than left to the next live run.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  attachFiles,
  attachedFileRowTexts,
  countAttachedFileControls,
  isFilenameAttached,
  uploadsInFlight,
} from "../src/engine/doc-uploader";

/** A dropzone plus one row per already-listed file, with the given action word. */
function mountWithRows(rows: Array<{ name: string; action: "Remove" | "Cancel" | "none" }>): void {
  const rowHtml = rows
    .map(
      (r) =>
        `<div class="uploaded-file"><span>${r.name}</span>` +
        (r.action === "none" ? "" : `<button class="act">${r.action}</button>`) +
        `</div>`,
    )
    .join("");
  document.body.innerHTML =
    '<div class="dropzone"><input type="file" id="desktop-drop" /></div>' + rowHtml;
}

function pdf(name: string): File {
  return new File([new Uint8Array([37, 80, 68])], name, { type: "application/pdf" });
}

describe("doc-uploader: a row whose upload is still running", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("counts a Cancel row as a file already on the page", () => {
    mountWithRows([{ name: "form_i20.pdf", action: "Cancel" }]);
    // Before the fix this was 0, which is what let the file be sent twice.
    expect(countAttachedFileControls()).toBe(1);
  });

  it("reports how many uploads are in flight", () => {
    mountWithRows([
      { name: "a.pdf", action: "Remove" },
      { name: "b.pdf", action: "Cancel" },
      { name: "c.pdf", action: "Cancel" },
    ]);
    // Drives the wait before Next: clicking it with these outstanding is what
    // triggered the "files will not upload if you leave this page" modal.
    expect(uploadsInFlight()).toBe(2);
  });

  it("sees the in-flight file's name, so the de-dupe can match it", () => {
    mountWithRows([{ name: "form_i20.pdf", action: "Cancel" }]);
    expect(isFilenameAttached("form_i20.pdf", attachedFileRowTexts())).toBe(true);
  });

  it("does NOT re-attach a file whose upload is still running", async () => {
    mountWithRows([{ name: "form_i20.pdf", action: "Cancel" }]);
    const res = await attachFiles([pdf("form_i20.pdf")]);
    // THE BUG, asserted: nothing new goes up, and it is reported as already
    // attached rather than as a failure.
    expect(res.attached).toBe(0);
    expect(res.alreadyAttached).toBe(1);
  });

  it("still attaches a genuinely different file while another is in flight", async () => {
    mountWithRows([{ name: "form_i20.pdf", action: "Cancel" }]);
    const input = document.getElementById("desktop-drop") as HTMLInputElement;
    let injected = 0;
    input.addEventListener("change", () => {
      injected += input.files?.length ?? 0;
      // Acknowledge it the way myUSCIS does — a new row, still uploading.
      const row = document.createElement("div");
      row.className = "uploaded-file";
      row.innerHTML = '<span>bank_statement.pdf</span><button class="act">Cancel</button>';
      document.body.appendChild(row);
    });
    await attachFiles([pdf("bank_statement.pdf")]);
    expect(injected).toBe(1);
  });

  it("treats a settled Remove row exactly as before (no regression)", async () => {
    mountWithRows([{ name: "i94.pdf", action: "Remove" }]);
    const res = await attachFiles([pdf("i94.pdf")]);
    expect(res.attached).toBe(0);
    expect(res.alreadyAttached).toBe(1);
    expect(uploadsInFlight()).toBe(0);
  });
});
