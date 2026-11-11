import { dbg } from "../engine/logger";
import { findButtonByText, isDisabled, normalise, visibleErrors } from "./nav";
import { FlagDocument, FlagDocumentsSpec } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BOX_TIMEOUT_MS = 8000;
const SAVE_TIMEOUT_MS = 30000;
const POLL_MS = 250;

export type DownloadFn = (doc: FlagDocument) => Promise<File | string>;

export interface DocumentOutcome {
  filename: string;
  status: "uploaded" | "already-there" | "failed";
  message?: string;
}

async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = probe();
    if (hit) return hit;
    await sleep(POLL_MS);
  }
  return probe();
}

function fileInput(spec: FlagDocumentsSpec): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[type="file"][name="${CSS.escape(spec.fileInputName)}"]`,
  );
}

function rowFor(filename: string): HTMLElement | null {
  const want = normalise(filename);
  for (const tr of Array.from(document.querySelectorAll<HTMLElement>("table tbody tr, [role='row']"))) {
    if (normalise(tr.textContent).includes(want)) return tr;
  }
  return null;
}

function boxScope(input: HTMLInputElement, spec: FlagDocumentsSpec): HTMLElement | null {
  let node = input.parentElement;
  for (let depth = 0; node && node !== document.body && depth < 15; depth++, node = node.parentElement) {
    if (findButtonByText(spec.saveButtonText, node)) return node;
  }
  return null;
}

function hand(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  const tracker = (input as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker) tracker.setValue("");
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const zone = input.parentElement;
  if (!zone || input.files?.length) return;
  for (const type of ["dragenter", "dragover", "drop"]) {
    const evt = new DragEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "dataTransfer", { value: dt });
    zone.dispatchEvent(evt);
  }
}

function setCategory(row: HTMLElement, spec: FlagDocumentsSpec): string {
  const select = row.querySelector<HTMLSelectElement>(`select[name="${CSS.escape(spec.categoryName)}"]`);
  if (!select) return "no category box in the row";
  const want = normalise(spec.category);
  const option = Array.from(select.options).find((o) => normalise(o.textContent) === want);
  if (!option) return `no "${spec.category}" category`;
  if (select.value === option.value) return "";
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, option.value);
  else select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return select.value === option.value ? "" : "category did not take";
}

function closeBox(scope: HTMLElement | null): void {
  const cancel = scope && (findButtonByText("Cancel", scope) ?? findButtonByText("Close", scope));
  if (cancel) cancel.click();
}

async function uploadOne(
  spec: FlagDocumentsSpec,
  doc: FlagDocument,
  download: DownloadFn,
): Promise<DocumentOutcome> {
  const filename = doc.filename;
  const got = await download(doc);
  if (typeof got === "string") return { filename, status: "failed", message: got };
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!spec.accept.includes(ext)) {
    return { filename, status: "failed", message: `FLAG takes ${spec.accept.join(" ")} only` };
  }
  if (got.size > spec.maxBytes) {
    return { filename, status: "failed", message: `over FLAG's ${Math.round(spec.maxBytes / 1048576)} MB limit` };
  }

  const add = findButtonByText(spec.addButtonText);
  if (!add || isDisabled(add)) {
    return { filename, status: "failed", message: `"${spec.addButtonText}" ${add ? "is greyed out" : "not found"}` };
  }
  add.click();
  const input = await waitFor(() => fileInput(spec), BOX_TIMEOUT_MS);
  if (!input) return { filename, status: "failed", message: "the upload box did not open" };
  hand(input, got);
  await waitFor(() => {
    const scope = boxScope(fileInput(spec) ?? input, spec);
    return scope && normalise(scope.textContent).includes(normalise(got.name)) ? true : null;
  }, BOX_TIMEOUT_MS);

  const scope = boxScope(fileInput(spec) ?? input, spec);
  const save = scope && findButtonByText(spec.saveButtonText, scope);
  if (!save || isDisabled(save)) {
    const errors = visibleErrors();
    closeBox(scope);
    return {
      filename,
      status: "failed",
      message: [`Save ${save ? "is greyed out" : "not found"}`, ...errors].join("; "),
    };
  }
  save.click();
  const row = await waitFor(() => (fileInput(spec) ? null : rowFor(got.name)), SAVE_TIMEOUT_MS);
  if (!row) {
    const errors = visibleErrors();
    closeBox(boxScope(fileInput(spec) ?? input, spec));
    return { filename, status: "failed", message: ["no row appeared after Save", ...errors].join("; ") };
  }
  await sleep(500);
  const problem = setCategory(rowFor(got.name) ?? row, spec);
  return { filename, status: "uploaded", message: problem ? `category: ${problem}` : undefined };
}

/** Upload each feed document FLAG does not already list, one per round trip. */
export async function uploadDocuments(
  spec: FlagDocumentsSpec,
  docs: FlagDocument[],
  download: DownloadFn,
): Promise<DocumentOutcome[]> {
  const out: DocumentOutcome[] = [];
  for (const doc of docs) {
    if (!doc?.url || !doc.filename) continue;
    const row = rowFor(doc.filename);
    if (row) {
      const problem = setCategory(row, spec);
      out.push({ filename: doc.filename, status: "already-there", message: problem || undefined });
      continue;
    }
    const res = await uploadOne(spec, doc, download);
    dbg(`  document ${doc.filename}: ${res.status}${res.message ? ` (${res.message})` : ""}`);
    out.push(res);
    await sleep(800);
  }
  return out;
}
