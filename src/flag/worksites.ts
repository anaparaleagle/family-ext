import { dbg } from "../engine/logger";
import { setValue } from "../engine/value-setter";
import { findButtonByText, isDisabled, normalise, visibleErrors } from "./nav";
import { setLabelRadio, setReactSelect } from "./widgets";
import { FlagWorksiteTableSpec } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BOX_TIMEOUT_MS = 6000;
const POLL_MS = 200;
const STATE_SETTLE_MS = 1500;

export interface WorksiteRow {
  city?: string;
  state?: string;
  county?: string;
}

export interface WorksiteOutcome {
  city: string;
  status: "added" | "already-there" | "failed";
  message?: string;
}

function byName(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
}

async function waitFor<T>(probe: () => T | null, timeoutMs = BOX_TIMEOUT_MS): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = probe();
    if (hit) return hit;
    await sleep(POLL_MS);
  }
  return probe();
}

/** Rows FLAG's worksite table already holds, as their visible text. */
function tableRows(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("table tbody tr")).map((tr) =>
    normalise(tr.textContent),
  );
}

function alreadyListed(row: WorksiteRow, rows: string[]): boolean {
  const city = normalise(row.city);
  const state = normalise(row.state);
  return rows.some((r) => r.includes(city) && (!state || r.includes(state)));
}

/** The open "Add Worksite" box: the nearest ancestor of its city box that holds its Save. */
function boxScope(spec: FlagWorksiteTableSpec): HTMLElement | null {
  let node = byName(spec.cityField)?.parentElement ?? null;
  for (let depth = 0; node && node !== document.body && depth < 15; depth++, node = node.parentElement) {
    if (findButtonByText(spec.saveButtonText, node)) return node;
  }
  return null;
}

function closeBox(scope: HTMLElement | null): void {
  const cancel = scope && (findButtonByText("Cancel", scope) ?? findButtonByText("Close", scope));
  if (cancel) cancel.click();
}

async function addOne(spec: FlagWorksiteTableSpec, row: WorksiteRow): Promise<WorksiteOutcome> {
  const city = row.city ?? "";
  const add = findButtonByText(spec.addButtonText);
  if (!add) return { city, status: "failed", message: `no "${spec.addButtonText}" button on this page` };
  if (isDisabled(add)) return { city, status: "failed", message: `"${spec.addButtonText}" is greyed out` };
  add.click();
  if (!(await waitFor(() => byName(spec.cityField)))) {
    return { city, status: "failed", message: "the Add Worksite box did not open" };
  }

  // County first: switching County/BLS Area wipes the city and state already typed.
  const steps: string[] = [];
  const basis = await setLabelRadio(spec.basisRadio, spec.basisValue);
  if (!basis.success) steps.push(`County/BLS choice: ${basis.message}`);
  await sleep(300);

  const cityRes = await setValue({ name: spec.cityField, kind: "text" }, city);
  if (!cityRes.success) steps.push(`city: ${cityRes.message}`);
  if (row.state) {
    const stateRes = await setValue({ name: spec.stateField, kind: "select" }, row.state);
    if (!stateRes.success) steps.push(`state: ${stateRes.message}`);
    await sleep(STATE_SETTLE_MS);
  }
  if (row.county) {
    const target = await waitFor(() => byName(spec.countyField), 3000);
    const countyRes = target
      ? await setReactSelect(spec.countyField, target, row.county)
      : { success: false, message: "county box not on page" };
    if (!countyRes.success) steps.push(`county: ${countyRes.message}`);
  }

  const scope = boxScope(spec);
  const save = scope && findButtonByText(spec.saveButtonText, scope);
  if (!save || isDisabled(save)) {
    const errors = scope ? visibleErrors() : [];
    closeBox(scope);
    return {
      city,
      status: "failed",
      message: [...steps, `Save ${save ? "is greyed out" : "not found"}`, ...errors].join("; "),
    };
  }
  save.click();
  const closed = await waitFor(() => (byName(spec.cityField) ? null : true));
  if (!closed) {
    const errors = visibleErrors();
    closeBox(boxScope(spec));
    return { city, status: "failed", message: [...steps, "FLAG kept the box open", ...errors].join("; ") };
  }
  const listed = await waitFor(() => (alreadyListed(row, tableRows()) ? true : null), 3000);
  if (!listed) return { city, status: "failed", message: [...steps, "saved, but no row appeared"].join("; ") };
  return { city, status: "added", message: steps.length ? steps.join("; ") : undefined };
}

/** Add every worksite the table does not already list, one box at a time. */
export async function fillWorksiteTable(
  spec: FlagWorksiteTableSpec,
  rows: WorksiteRow[],
): Promise<WorksiteOutcome[]> {
  const out: WorksiteOutcome[] = [];
  for (const row of rows) {
    if (!row.city) continue;
    if (alreadyListed(row, tableRows())) {
      out.push({ city: row.city, status: "already-there" });
      continue;
    }
    const res = await addOne(spec, row);
    dbg(`  worksite ${row.city}: ${res.status}${res.message ? ` (${res.message})` : ""}`);
    out.push(res);
    await sleep(800);
  }
  return out;
}
