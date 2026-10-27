// ===========================================================================
// DRIVING A FLAG MODAL — the ETA-9035's OES Wage Calculator.
//
// WHY THIS EXISTS AT ALL. The descriptor used to say the calculator "stays
// manual", carried from a decision taken on 2026-09-01 before anyone had read
// the H-1B extension's Section F path end to end. That assumption is what left
// F.11 (prevailing wage), F.11a, F.13a (wage level) and F.13b (source year)
// unanswerable: FLAG DISABLES all four the moment F.12/13/14 says OES, because
// the calculator owns them. The old extension drove the modal for years
// (paraleagle-ext, src/content/lca-filler.ts, fillSectionF steps 2-6) and its
// own comment is explicit that paralegals depended on it.
//
// WHAT THE CALCULATOR IS. A DOL tool, not a box on the form: state, area,
// industry collection, SOC and a wage level in, one prevailing wage out, which
// it then writes back into the application. So its inputs are not in the
// backend feed — the feed describes the FORM. Every one of them is either a
// Section F value the feed already sends, or a standing choice this file makes
// and the toolbar states.
//
// WHAT IT WILL NOT DO
//   * press anything outside the open dialog — every search is scoped to it,
//     so the application's own Review & Submit is out of reach;
//   * press the modal's Submit when Calculate produced no wage. A modal left
//     open with the answer blank is a caseworker finishing it by hand; a modal
//     submitted empty is a federal form with a wage nobody chose.
// ===========================================================================

import { dbg } from "../engine/logger";
import { locateElement, setValue } from "../engine/value-setter";
import { findButtonByText, isDisabled, openDialog } from "./nav";
import { FlagModalSpec, flagFieldSpec, gateIsAnswered, modalFieldValue } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How long the modal is given to mount after its button is pressed. */
const OPEN_TIMEOUT_MS = 5000;
/** How long the calculator is given to produce a wage after Calculate. */
const CALCULATE_TIMEOUT_MS = 8000;
const POLL_MS = 150;
/** A settle after each answer: FLAG repopulates the area list off the state. */
const SETTLE_MS = 400;

export interface ModalFieldOutcome {
  name: string;
  status: "filled" | "no-value" | "not-rendered" | "failed";
  message?: string;
}

export interface ModalOutcome {
  /** "skipped" is the ordinary case for a filing whose wage source is not OES. */
  status: "applied" | "skipped" | "no-button" | "did-not-open" | "no-result" | "not-submitted";
  fields: ModalFieldOutcome[];
  /** What the calculator put in its result box, when it produced anything. */
  result?: string;
  message?: string;
}

/** Is the control writable — on the page, and not disabled by FLAG? */
function writable(el: HTMLElement | null): boolean {
  return !!el && !isDisabled(el);
}

/** Wait for the modal to mount, and hand it back. */
async function waitForDialog(): Promise<HTMLElement | null> {
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const dialog = openDialog();
    if (dialog) return dialog;
    await sleep(POLL_MS);
  }
  return null;
}

/**
 * Read the calculator's answer: the value in its result box, or "".
 *
 * FLAG shows an empty masked money box as its placeholder ("$nnnn.nn"), which
 * is not an answer — the old extension checked for that exact string and this
 * keeps the check, widened to any placeholder-shaped text.
 */
function readResult(spec: FlagModalSpec, scope: ParentNode): string {
  const el =
    scope.querySelector<HTMLInputElement>(`#${CSS.escape(spec.resultField)}`) ??
    scope.querySelector<HTMLInputElement>(`[name="${CSS.escape(spec.resultField)}"]`);
  const raw = (el?.value ?? "").trim();
  if (!raw || /n{2,}/i.test(raw)) return "";
  return /\d/.test(raw) ? raw : "";
}

/**
 * Open the modal, fill it, calculate, check, submit.
 *
 * Every failure is a RESULT, not a throw: the section around it still has a
 * dozen boxes worth typing, and a caseworker who is told "the calculator did
 * not open, run it yourself" can finish the filing. The old extension logged
 * these to the console only, which is why a redesigned modal went unnoticed.
 */
export async function runModal(
  spec: FlagModalSpec,
  values: Record<string, string>,
): Promise<ModalOutcome> {
  if (!gateIsAnswered(spec.onlyWhen, values)) {
    return { status: "skipped", fields: [], message: `${spec.onlyWhen.by} is not the OES branch` };
  }

  const opener = findButtonByText(spec.openButton);
  if (!opener) {
    dbg(`modal: no "${spec.openButton}" button on this section`);
    return { status: "no-button", fields: [], message: `No "${spec.openButton}" button on the page.` };
  }
  opener.click();

  const dialog = await waitForDialog();
  if (!dialog) {
    dbg(`modal: "${spec.openButton}" did not open a dialog within ${OPEN_TIMEOUT_MS}ms`);
    return {
      status: "did-not-open",
      fields: [],
      message: `"${spec.openButton}" did not open. Run it yourself.`,
    };
  }

  const fields: ModalFieldOutcome[] = [];
  const before = spec.fields.filter((f) => !f.afterCalculate);
  const after = spec.fields.filter((f) => f.afterCalculate);

  for (const field of before) fields.push(await fillModalField(field, values));

  const calculate = findButtonByText(spec.calculateButton, dialog);
  if (!calculate) {
    return {
      status: "not-submitted",
      fields,
      message: `No "${spec.calculateButton}" button in the calculator. Finish it yourself.`,
    };
  }
  calculate.click();

  // The wage level and the per-unit are disabled until there is a wage to apply
  // them to, so they are answered here rather than above.
  const deadline = Date.now() + CALCULATE_TIMEOUT_MS;
  let result = "";
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    result = readResult(spec, dialog);
    if (result) break;
  }

  for (const field of after) fields.push(await fillModalField(field, values));

  // Answering the level re-prices the wage, so read it once more.
  await sleep(SETTLE_MS);
  result = readResult(spec, dialog) || result;

  if (!result) {
    dbg("modal: the calculator produced no prevailing wage — leaving it open");
    return {
      status: "no-result",
      fields,
      message:
        "The OES Wage Calculator produced no prevailing wage, so it was NOT " +
        "submitted. It is still open — finish it yourself and press its Submit.",
    };
  }

  const submit = findButtonByText(spec.submitButton, dialog);
  if (!submit) {
    return {
      status: "not-submitted",
      fields,
      result,
      message: `The calculator gave ${result} but has no "${spec.submitButton}" button. Apply it yourself.`,
    };
  }
  submit.click();
  await sleep(SETTLE_MS);
  return { status: "applied", fields, result };
}

async function fillModalField(
  field: FlagModalSpec["fields"][number],
  values: Record<string, string>,
): Promise<ModalFieldOutcome> {
  const value = modalFieldValue(field, values);
  if (!value) {
    return {
      name: field.name,
      status: "no-value",
      message: field.from ? `the feed sent nothing for ${field.from}` : undefined,
    };
  }
  // Radios resolve across a group rather than to one element, so the presence
  // check differs; everything else is located the way the fill chain locates it.
  const present =
    field.kind === "radio"
      ? document.querySelector<HTMLElement>(`input[type="radio"][name="${CSS.escape(field.name)}"]`)
      : locateElement(flagFieldSpec(field));
  if (!writable(present)) {
    return {
      name: field.name,
      status: "not-rendered",
      message: present ? "the calculator has this disabled" : "not in the calculator",
    };
  }
  const res = await setValue(flagFieldSpec(field), value);
  // Each answer re-renders the ones below it — the area list is rebuilt off the
  // state, and the level list off the area.
  await sleep(SETTLE_MS);
  return {
    name: field.name,
    status: res.success ? "filled" : "failed",
    message: res.message,
  };
}
