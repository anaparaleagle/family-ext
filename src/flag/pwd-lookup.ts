// F.12a: FLAG takes the PWD number only through its lookup over the account's own ETA-9141 cases.

import { dbg } from "../engine/logger";
import { setValue } from "../engine/value-setter";
import { findButtonByText, isDisabled, openDialog } from "./nav";

export const PWD_LOOKUP_KEY = "f12a_pwd_tracking_number";
export const PWD_LOOKUP_BUTTON = "PWD Case Lookup";
export const PWD_GATE = "_section_f_f12_f13_f14_prevailing_wage_question";
export const PWD_BRANCH = "f12_is_dol_prevailing_wage";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const WAIT_MS = 2500;

export interface PwdLookupOutcome {
  status: "applied" | "skipped" | "no-button" | "did-not-open" | "not-found" | "not-applied";
  message?: string;
}

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, "").toUpperCase();

function closeDialog(dialog: HTMLElement): void {
  const close = Array.from(dialog.querySelectorAll<HTMLElement>("button, a, [role='button'], div, span")).find(
    (el) => el.children.length < 3 && (el.textContent ?? "").trim().toUpperCase() === "CLOSE",
  );
  close?.click();
}

/** The row whose Case Number cell is this PWD, and the control that picks it. */
function matchingRow(dialog: HTMLElement, number: string): HTMLElement | null {
  const table = dialog.querySelector("table");
  if (!table) return null;
  const headers = Array.from(table.querySelectorAll("th")).map((th) => norm(th.textContent));
  const col = headers.indexOf("CASENUMBER");
  for (const row of Array.from(table.querySelectorAll<HTMLElement>("tbody tr"))) {
    const cells = row.querySelectorAll("td");
    const cell = col >= 0 ? cells[col] : null;
    const text = cell ? norm(cell.textContent) : norm(row.textContent);
    if (text.includes(norm(number))) return row;
  }
  return null;
}

export async function runPwdLookup(number: string): Promise<PwdLookupOutcome> {
  if (!number) return { status: "skipped" };
  const opener = findButtonByText(PWD_LOOKUP_BUTTON);
  if (!opener) return { status: "no-button", message: `No "${PWD_LOOKUP_BUTTON}" button on the page.` };

  const before = openDialog();
  opener.click();
  await sleep(WAIT_MS);
  const dialog = openDialog();
  if (!dialog || dialog === before) {
    return { status: "did-not-open", message: `"${PWD_LOOKUP_BUTTON}" did not open. Enter PWD ${number} yourself.` };
  }

  await setValue({ name: "job-order-search", kind: "text", locate: { id: "job-order-search" } }, number);
  findButtonByText("Search", dialog)?.click();
  await sleep(WAIT_MS);

  const row = matchingRow(dialog, number);
  if (!row) {
    closeDialog(dialog);
    return {
      status: "not-found",
      message:
        `PWD ${number} is not among this FLAG account's ETA-9141 cases, so the ` +
        "lookup has nothing to pick. Look it up yourself before you file.",
    };
  }
  const picker =
    row.querySelector<HTMLElement>("input[type='radio'], input[type='checkbox'], button") ??
    (row.querySelector("td") as HTMLElement | null) ??
    row;
  picker.click();
  await sleep(500);

  const proceed = findButtonByText("Continue", dialog);
  if (!proceed || isDisabled(proceed)) {
    dbg("pwd-lookup: Continue stayed greyed after picking the row");
    closeDialog(dialog);
    return { status: "not-applied", message: `Found PWD ${number}, but FLAG would not take the pick. Pick it yourself.` };
  }
  proceed.click();
  await sleep(WAIT_MS);
  if (openDialog() === dialog && dialog.isConnected) {
    closeDialog(dialog);
    return { status: "not-applied", message: `The PWD lookup did not close for ${number}. Pick it yourself.` };
  }
  return { status: "applied", message: `PWD ${number} picked through FLAG's lookup — check it before you file.` };
}
