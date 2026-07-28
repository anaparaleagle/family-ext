// ===========================================================================
// HARVESTED from paraleagle-ext src/content/i129-doc-uploader.ts on the
// fix/i129-doc-upload-batching branch (the batching version). Kept the proven
// DataTransfer injection + 5-files-per-batch + count-delta wait. Stripped the
// I-129 specifics (I129_DOC_MAP, certified-LCA guard, heading matching) — those
// were "which file goes on which page" knowledge, which for the family flow
// lives in the i130 layer (from the backend upload_pages descriptors).
//
// This module is data-agnostic: hand it a file input and a list of File objects
// and it attaches them, respecting the 5-file cap, waiting for each batch to be
// acknowledged before the next.
// ===========================================================================

import { dbg } from "./logger";

/** USCIS accepts at most 5 files per upload action; a single DataTransfer drop
 * carrying more silently drops the overflow. */
const MAX_FILES_PER_BATCH = 5;

export interface AttachResult {
  attached: number;
  /** Files already on the page, so deliberately not re-attached (SOF-1005).
   * Counted separately from `attached` so a run that legitimately does nothing
   * does not read as a silent no-op in the debug panel. */
  alreadyAttached: number;
  warnings: string[];
}

/**
 * Attach a set of files to the current page's react-dropzone file input, in
 * batches of MAX_FILES_PER_BATCH, waiting for each batch to be acknowledged.
 */
export async function attachFiles(files: File[]): Promise<AttachResult> {
  const warnings: string[] = [];
  if (files.length === 0) return { attached: 0, alreadyAttached: 0, warnings };

  const fileInput =
    document.querySelector<HTMLInputElement>('input[type="file"]#desktop-drop') ||
    document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) {
    dbg("doc-uploader: no file input on this page");
    return { attached: 0, alreadyAttached: 0, warnings: ["No file input found on this page."] };
  }

  // SOF-1005: never attach a file the page is already showing. Callers that know
  // the filenames up front should skip them BEFORE downloading (runner/doc-flow
  // does), but this is the data-agnostic engine every caller goes through, so the
  // guarantee belongs here too — a second visit must not re-attach, whoever asked.
  const rowTexts = attachedFileRowTexts();
  const pending = files.filter((f) => !isFilenameAttached(f.name, rowTexts));
  const alreadyAttached = files.length - pending.length;
  if (pending.length === 0) {
    dbg(`doc-uploader: all ${alreadyAttached} file(s) already attached — nothing to do`);
    return { attached: 0, alreadyAttached, warnings };
  }

  let attached = 0;
  for (let i = 0; i < pending.length; i += MAX_FILES_PER_BATCH) {
    const batch = pending.slice(i, i + MAX_FILES_PER_BATCH);
    const dt = new DataTransfer();
    for (const f of batch) dt.items.add(f);

    const baseline = countAttachedFileControls();
    const lastFilename = batch[batch.length - 1].name;

    injectFilesIntoDropzone(fileInput, dt);
    dbg(`doc-uploader: injected batch of ${batch.length} (${i + batch.length}/${pending.length})`);

    const ok = await waitForUploadAccepted(fileInput, lastFilename, baseline);
    if (ok) {
      attached += batch.length;
    } else {
      warnings.push(
        `myUSCIS did not acknowledge the upload batch ending "${lastFilename}" ` +
          `within the wait window. Verify the page before filing.`,
      );
    }
  }
  return { attached, alreadyAttached, warnings };
}

/**
 * Hand a set of files to react-dropzone via BOTH the input-change path (with a
 * _valueTracker reset so React re-reads) AND a synthetic drag-drop on the
 * dropzone root (react-dropzone reads event.dataTransfer.files on drop).
 */
function injectFilesIntoDropzone(fileInput: HTMLInputElement, dt: DataTransfer): void {
  // Path A: input change (reset React's value tracker so it re-reads).
  try {
    const tracker = (fileInput as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
    if (tracker) tracker.setValue("");
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    dbg(`doc-uploader: input-change injection threw: ${errMsg(err)}`);
  }

  // Path B: synthetic drop on the react-dropzone root.
  const dropTarget = findDropzoneRoot(fileInput);
  if (dropTarget) {
    try {
      for (const type of ["dragenter", "dragover", "drop"]) {
        const evt = new DragEvent(type, { bubbles: true, cancelable: true });
        // DragEvent.dataTransfer is read-only/null when constructed in content
        // scripts; force our populated DataTransfer on so the handler reads it.
        Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
        dropTarget.dispatchEvent(evt);
      }
    } catch (err) {
      dbg(`doc-uploader: synthetic-drop injection threw: ${errMsg(err)}`);
    }
  }
}

function findDropzoneRoot(fileInput: HTMLInputElement): HTMLElement | null {
  const closest = fileInput.closest<HTMLElement>(
    '[data-testid], .dropzone, [class*="dropzone"], [class*="Dropzone"], [aria-label*="upload" i]',
  );
  return closest ?? (fileInput.parentElement as HTMLElement | null);
}

function removeControls(): HTMLElement[] {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
  );
  return controls.filter((c) => {
    const t = (c.textContent || "").trim().toLowerCase();
    return t === "remove" || t === "delete" || t === "remove file" || t === "delete file";
  });
}

/** Count per-file Remove/Delete controls — the reliable "page has files" signal. */
export function countAttachedFileControls(): number {
  return removeControls().length;
}

/**
 * The text of each attached-file row already on the page (SOF-1005).
 *
 * myUSCIS prints an attached file's NAME beside its Remove control, so we anchor
 * on the same Remove controls ``countAttachedFileControls`` already trusts and
 * read the surrounding row's text. We walk up a couple of levels because the
 * name and the button are siblings inside a row wrapper, not parent/child, and we
 * stop well short of <body> so a whole-page text blob can never be mistaken for a
 * filename. Returns raw row text — matching is ``isFilenameAttached``'s job.
 */
export function attachedFileRowTexts(): string[] {
  const texts: string[] = [];
  for (const control of removeControls()) {
    let node: HTMLElement | null = control.parentElement;
    for (let depth = 0; depth < 3 && node && node !== document.body; depth += 1) {
      const text = (node.textContent || "").trim();
      if (text) texts.push(text);
      node = node.parentElement;
    }
  }
  return texts;
}

/**
 * Is `filename` already attached on this page?
 *
 * Compared on the same NEEDLE the upload-acknowledgement wait uses (the stem,
 * capped at 12 chars) so "already attached" and "the upload was accepted" can
 * never disagree about whether a given file is on the page — myUSCIS truncates
 * long names in the file list, which is why the full name is not matchable.
 */
export function isFilenameAttached(filename: string, rowTexts: string[]): boolean {
  const needle = filenameNeedle(filename);
  if (!needle) return false;
  return rowTexts.some((t) => t.includes(needle));
}

function filenameNeedle(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.length > 12 ? stem.slice(0, 12) : stem;
}

/**
 * Poll until myUSCIS acknowledges a batch: the filename text appears, OR the
 * per-file control count grows past the pre-batch baseline.
 */
async function waitForUploadAccepted(
  fileInput: HTMLInputElement,
  expectedFilename: string,
  baselineControlCount: number,
  timeoutMs = 20000,
): Promise<boolean> {
  const start = Date.now();
  const stem = expectedFilename.replace(/\.[^.]+$/, "");
  const needle = stem.length > 12 ? stem.slice(0, 12) : stem;

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    if (needle && document.body.innerText.includes(needle)) return true;
    if (countAttachedFileControls() > baselineControlCount) return true;
    if (
      fileInput.files &&
      fileInput.files.length > 0 &&
      countAttachedFileControls() > baselineControlCount
    ) {
      return true;
    }
  }
  return false;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
