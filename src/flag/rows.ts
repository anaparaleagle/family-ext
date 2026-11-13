import { dbg } from "../engine/logger";
import { bridge } from "./bridge-client";
import { findButtonByText, isDisabled, normalise, visibleErrors } from "./nav";
import { setFlagValue } from "./widgets";
import { FlagAddRowsSpec, FlagField, FlagPickRowsSpec } from "./types";
import { tunable } from "../engine/tuning";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BOX_TIMEOUT_MS = 6000;
const REVEAL_TIMEOUT_MS = 3000;
const POLL_MS = 200;
const COUNTRY_SETTLE_MS = 1500;
const TUNE = tunable("flagRows", { BOX_TIMEOUT_MS, REVEAL_TIMEOUT_MS, POLL_MS, COUNTRY_SETTLE_MS });
const ADD_TEXT = /^\+?\s*add\b/i;
const NEVER = /add data|add document/i;

export type RowValues = Record<string, string>;

export interface AddRowOutcome {
  label: string;
  status: "added" | "already-there" | "failed";
  message?: string;
}

async function waitFor<T>(probe: () => T | null, timeoutMs = TUNE.BOX_TIMEOUT_MS): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = probe();
    if (hit) return hit;
    await sleep(TUNE.POLL_MS);
  }
  return probe();
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** The DOM name a row field carries: exact, or FLAG's own prefix before the same stem. */
function domName(name: string): string | null {
  if (document.querySelector(`[name="${CSS.escape(name)}"]`)) return name;
  const stem = name.replace(/^.*[\].]/, "");
  const hit = Array.from(document.querySelectorAll<HTMLElement>("[name]")).find((el) => {
    const n = el.getAttribute("name") ?? "";
    return n === stem || n.endsWith(`.${stem}`) || n.endsWith(`]${stem}`);
  });
  return hit?.getAttribute("name") ?? null;
}

/** The "+ Add ..." control on the section, never FLAG's "Add Data" or the documents button. */
function addControl(text?: string): HTMLElement | null {
  const want = text ? normalise(text) : "";
  let best: HTMLElement | null = null;
  let bestLength = Infinity;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a, span, div, p, [role='button']"))) {
    if (el.closest("#mk-flag-toolbar") || el.closest("nav, aside")) continue;
    const label = normalise(el.textContent);
    if (!label || label.length > 60 || NEVER.test(label) || !visible(el)) continue;
    if (want ? !label.startsWith(want) : !ADD_TEXT.test(label)) continue;
    if (label.length <= bestLength) {
      best = el;
      bestLength = label.length;
    }
  }
  return best;
}

async function press(el: HTMLElement): Promise<void> {
  const via = await bridge("clickUp", {}, el);
  if (!via?.ok) el.click();
}

/** The open Add box: the nearest ancestor of a row field that holds its Save. */
function boxScope(anchor: string, save: string): HTMLElement | null {
  let node = document.querySelector<HTMLElement>(`[name="${CSS.escape(anchor)}"]`)?.parentElement ?? null;
  for (let depth = 0; node && node !== document.body && depth < 15; depth++, node = node.parentElement) {
    if (findButtonByText(save, node)) return node;
  }
  return null;
}

function closeBox(scope: HTMLElement | null): void {
  const cancel = scope && (findButtonByText("Cancel", scope) ?? findButtonByText("Close", scope));
  if (cancel) cancel.click();
}

function tableText(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("table tr")).map((tr) => normalise(tr.textContent));
}

async function pickOptionNaming(name: string, keyword: string): Promise<boolean> {
  const want = normalise(keyword);
  const el = await waitFor(() => {
    const s = document.querySelector<HTMLSelectElement>(`select[name="${CSS.escape(name)}"]`);
    if (!s || !Array.from(s.options).some((o) => o.value)) return null;
    return !s.disabled || normalise(s.selectedOptions[0]?.textContent).includes(want) ? s : null;
  }, TUNE.REVEAL_TIMEOUT_MS);
  if (!el) return false;
  const opt = Array.from(el.options).find((o) => o.value && !o.disabled && normalise(o.textContent).includes(want));
  if (!opt) return false;
  if (el.value === opt.value) return true;
  if (el.disabled) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(el, opt.value);
  else el.value = opt.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function addOne(spec: FlagAddRowsSpec, row: RowValues, label: string): Promise<AddRowOutcome> {
  const control = addControl(spec.addText) ?? addControl();
  if (!control) return { label, status: "failed", message: `no "${spec.addText ?? "+ Add"}" control on this section` };
  await press(control);
  const first = spec.fields[0];
  const anchor = await waitFor(() => domName(first.name));
  if (!anchor) return { label, status: "failed", message: "the Add box did not open" };

  const notes: string[] = [];
  for (const field of spec.fields) {
    const keyword = field.optionFor?.keywords[row[field.optionFor.from] ?? ""];
    const want = row[field.name];
    if (!want && !keyword) continue;
    const name = await waitFor(() => domName(field.name), field === first ? TUNE.BOX_TIMEOUT_MS : TUNE.REVEAL_TIMEOUT_MS);
    if (!name) {
      notes.push(`${field.name}: not on the box`);
      continue;
    }
    if (!want) {
      if (!(await pickOptionNaming(name, keyword ?? ""))) {
        const fail = `${field.name}: no option naming "${keyword}"`;
        closeBox(boxScope(anchor, spec.saveText));
        return { label, status: "failed", message: [...notes, fail].join("; ") };
      }
      continue;
    }
    const res = await setFlagValue({ ...field, name } as FlagField, want);
    if (!res.success) notes.push(`${field.name}: ${res.message}`);
    if (res.success && /country/i.test(field.name)) await sleep(TUNE.COUNTRY_SETTLE_MS);
    else await sleep(150);
  }

  const scope = boxScope(anchor, spec.saveText);
  const save = scope && findButtonByText(spec.saveText, scope);
  if (!save || isDisabled(save)) {
    const errors = visibleErrors();
    closeBox(scope);
    return { label, status: "failed", message: [...notes, `Save ${save ? "is greyed out" : "not found"}`, ...errors].join("; ") };
  }
  save.click();
  const closed = await waitFor(() => (domName(first.name) ? null : true));
  if (!closed) {
    const errors = visibleErrors();
    closeBox(boxScope(anchor, spec.saveText));
    return { label, status: "failed", message: [...notes, "FLAG kept the box open", ...errors].join("; ") };
  }
  return { label, status: "added", message: notes.length ? notes.join("; ") : undefined };
}

/** Add every row the section's table does not already list, one Add box at a time. */
export async function fillAddRows(spec: FlagAddRowsSpec, rows: RowValues[]): Promise<AddRowOutcome[]> {
  const out: AddRowOutcome[] = [];
  await sleep(1200);
  await waitFor(() => (tableText().length > 1 ? true : null), 4000);
  for (const row of rows) {
    const label = row[spec.labelField] ?? spec.fields.map((f) => row[f.name]).find(Boolean) ?? "row";
    const key = normalise(label);
    if (key && tableText().some((t) => t.includes(key))) {
      out.push({ label, status: "already-there" });
      continue;
    }
    let res = await addOne(spec, row, label);
    if (res.status === "failed" && !/did not open|no ".*" control/.test(res.message ?? "")) {
      await sleep(1500);
      const open = domName(spec.fields[0].name);
      if (open) closeBox(boxScope(open, spec.saveText));
      await sleep(800);
      if (!tableText().some((t) => key && t.includes(key))) res = await addOne(spec, row, label);
    }
    dbg(`  ${spec.rowsKey} row ${label}: ${res.status}${res.message ? ` (${res.message})` : ""}`);
    out.push(res);
    await sleep(800);
  }
  return out;
}

/** Appendix B: open the PWD worksite pick-list and tick the case's worksites (all of them when none are named). */
export async function pickWorksiteRows(spec: FlagPickRowsSpec, rows: RowValues[]): Promise<AddRowOutcome[]> {
  const open = findButtonByText(spec.addButtonText);
  if (!open) return [{ label: spec.addButtonText, status: "failed", message: `no "${spec.addButtonText}" button` }];
  await press(open);
  const listed = await waitFor(() => {
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(
      (b) => !b.closest("#mk-flag-toolbar") && b.closest("tr, li, label"),
    );
    return boxes.length ? boxes : null;
  });
  if (!listed) return [{ label: spec.addButtonText, status: "failed", message: "the PWD offered no worksites to pick" }];

  const out: AddRowOutcome[] = [];
  const cities = rows.map((r) => normalise(r.city)).filter(Boolean);
  for (const box of listed) {
    const line = normalise(box.closest("tr, li, label")?.textContent);
    const wanted = !cities.length || cities.some((c) => line.includes(c));
    if (!wanted) continue;
    const label = line.slice(0, 60) || "worksite";
    if (box.checked) {
      out.push({ label, status: "already-there" });
      continue;
    }
    const via = await bridge("checkbox", { want: true }, box);
    if (!via?.ok) box.click();
    await sleep(200);
    out.push(box.checked ? { label, status: "added" } : { label, status: "failed", message: "FLAG did not take the tick" });
  }
  for (const city of cities) {
    if (!out.some((o) => o.label.includes(city))) out.push({ label: city, status: "failed", message: "not in the PWD's worksites" });
  }
  const dialog = listed[0].closest<HTMLElement>("[role='dialog'], .ReactModal__Content, #simple-modal") ?? document.body;
  const save = spec.saveTexts.map((t) => findButtonByText(t, dialog)).find((b) => b && !isDisabled(b));
  if (save) save.click();
  else out.push({ label: "pick-list", status: "failed", message: "no Save on the pick-list; press it yourself" });
  return out;
}
