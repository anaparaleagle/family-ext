// ===========================================================================
// DRIVING A FLAG MODAL — the ETA-9035's OES Wage Calculator.
//
// A STEP-FOR-STEP PORT of the H-1B extension's Section F flow
// (paraleagle-ext, src/content/lca-filler.ts `fillSectionF`, steps 2-6), which
// drove this modal on flag.dol.gov in production for years. Its sequencing and
// its waits are kept as they are, including the ones that look generous: they
// were tuned against the live form, and neither of us can reach it to retune
// them. Where this file adds anything it is a REPORT, not a different move —
// the old flow logged to the console, which is how a redesigned modal went
// unnoticed for a release.
//
// WHY IT EXISTS AT ALL. The descriptor used to say the calculator "stays
// manual", carried from a decision taken on 2026-09-01 before anyone had read
// the old path end to end. That assumption is what left F.11 (prevailing
// wage), F.11a, F.13a (wage level) and F.13b (source year) unanswerable: FLAG
// DISABLES all four the moment F.12/13/14 says OES, because the calculator
// owns them and writes them itself on Submit.
//
// WHAT THE CALCULATOR IS. A DOL tool, not a box on the form: state, area,
// industry collection, SOC and a wage level in, one prevailing wage out, which
// it then applies to the application. Its inputs are therefore not in the
// backend feed — the feed describes the FORM. Each one is either a Section F
// value the feed already sends, or a standing choice this file makes and the
// toolbar states, exactly as the old extension's `F_OES` field block did.
// ===========================================================================

import { dbg } from "../engine/logger";
import { locateElement, setValue } from "../engine/value-setter";
import { findButtonByText, isDisabled, openDialog } from "./nav";
import { FlagModalSpec, flagFieldSpec, gateIsAnswered, modalFieldValue } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The old extension's own waits, kept to the millisecond.
/** After pressing the button that opens it. */
const AFTER_OPEN_MS = 2000;
/** After each answer inside it — the area list is rebuilt off the state. */
const AFTER_ANSWER_MS = 500;
/** Before the area combobox specifically, for its dependent options. */
const BEFORE_AREA_MS = 500;
/** After Calculate. */
const AFTER_CALCULATE_MS = 3000;
/** After the modal's own Submit. */
const AFTER_SUBMIT_MS = 2000;

/** Added here, not in the old file: a poll on top of the fixed wait, so a slow
 * page costs a moment rather than the whole modal. The fixed wait still runs
 * first — it is what the live form was tuned against. */
const EXTRA_WAIT_MS = 3000;
const POLL_MS = 150;

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

/** The modal, after the old flow's fixed wait and then a short poll. */
async function waitForDialog(): Promise<HTMLElement | null> {
  await sleep(AFTER_OPEN_MS);
  const deadline = Date.now() + EXTRA_WAIT_MS;
  while (Date.now() < deadline) {
    const dialog = openDialog();
    if (dialog) return dialog;
    await sleep(POLL_MS);
  }
  return openDialog();
}

/**
 * Read the calculator's answer: the value in its result box, or "".
 *
 * The old flow checked `#OES_prevailing_wage` against the literal placeholder
 * "$nnnn.nn"; that check is kept and widened to any placeholder-shaped text.
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
 * The modal's own button, searched inside the dialog first.
 *
 * The old flow searched the whole page for "Submit". Narrowed to the dialog
 * because the application's own Submit lives on the page and has no undo — but
 * it falls back to a page-wide search so a modal that renders its footer
 * outside the dialog node is still driven, exactly as before. The never-click
 * list still applies to both, so "Review & Submit" is unreachable either way.
 */
function modalButton(text: string, dialog: HTMLElement): HTMLElement | null {
  return findButtonByText(text, dialog) ?? findButtonByText(text);
}

/**
 * Open the modal, fill it, calculate, read the answer, submit.
 *
 * Every failure is a RESULT, not a throw: the section around it still has a
 * dozen boxes worth typing, and a caseworker told "the calculator did not
 * open, run it yourself" can finish the filing.
 */
export async function runModal(
  spec: FlagModalSpec,
  values: Record<string, string>,
): Promise<ModalOutcome> {
  if (!gateIsAnswered(spec.onlyWhen, values)) {
    return { status: "skipped", fields: [], message: `${spec.onlyWhen.by} is not the OES branch` };
  }

  // Step 2 of the old flow. The button only exists once the source radio says
  // OES, which the caller has just answered and waited on.
  const opener = findButtonByText(spec.openButton);
  if (!opener) {
    dbg(`modal: no "${spec.openButton}" button on this section`);
    return { status: "no-button", fields: [], message: `No "${spec.openButton}" button on the page.` };
  }
  opener.click();

  const dialog = await waitForDialog();
  if (!dialog) {
    dbg(`modal: "${spec.openButton}" did not open a dialog`);
    return {
      status: "did-not-open",
      fields: [],
      message: `"${spec.openButton}" did not open. Run it yourself.`,
    };
  }

  // Step 3: the pre-calculate answers, in the order the old field map listed
  // them — state, collection type, area basis, area, R&D flag.
  const fields: ModalFieldOutcome[] = [];
  for (const field of spec.fields.filter((f) => !f.afterCalculate)) {
    fields.push(await fillModalField(field, values));
  }

  // Step 4: Calculate.
  const calculate = modalButton(spec.calculateButton, dialog);
  if (!calculate) {
    dbg(`modal: no "${spec.calculateButton}" button`);
    return {
      status: "not-submitted",
      fields,
      message: `No "${spec.calculateButton}" button in the calculator. Finish it yourself.`,
    };
  }
  calculate.click();
  await sleep(AFTER_CALCULATE_MS);

  // Step 5: the wage level and the per-unit, which FLAG keeps disabled until
  // Calculate has produced a wage to apply them to.
  for (const field of spec.fields.filter((f) => f.afterCalculate)) {
    fields.push(await fillModalField(field, values));
  }

  // Step 5b: read the answer back. The old flow logged a WARNING here and
  // carried on to Submit either way, and that is kept — a modal left open sits
  // over the rest of Section F and would cost every box below it. The
  // difference is that the warning now reaches the toolbar instead of the
  // console, because an empty prevailing wage is the one thing a caseworker
  // has to see before filing.
  let result = readResult(spec, dialog);
  if (!result) {
    const deadline = Date.now() + EXTRA_WAIT_MS;
    while (!result && Date.now() < deadline) {
      await sleep(POLL_MS);
      result = readResult(spec, dialog);
    }
  }
  if (!result) dbg("modal: WARNING — the calculator produced no prevailing wage");

  // Step 6: Submit, which applies the wage to F.11 / F.11a / F.13a / F.13b and
  // closes the modal.
  const submit = modalButton(spec.submitButton, dialog);
  if (!submit) {
    dbg(`modal: no "${spec.submitButton}" button in the calculator`);
    return {
      status: "not-submitted",
      fields,
      result,
      message:
        `The calculator has no "${spec.submitButton}" button, so nothing was ` +
        "applied. Finish it yourself.",
    };
  }
  submit.click();
  await sleep(AFTER_SUBMIT_MS);

  if (!result) {
    return {
      status: "no-result",
      fields,
      message:
        "The OES Wage Calculator produced NO prevailing wage. It was submitted " +
        "so the rest of the section could be filled, but F.11 and F.13a are " +
        "empty — run the calculator yourself before you file.",
    };
  }
  return { status: "applied", fields, result };
}

async function fillModalField(
  field: FlagModalSpec["fields"][number],
  values: Record<string, string>,
): Promise<ModalFieldOutcome> {
  // The old flow paused before the area combobox for its dependent options.
  if (field.waitBefore) await sleep(BEFORE_AREA_MS);

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
  // Each answer re-renders the ones below it — the area list is rebuilt off
  // the state, the level list off the area.
  if (res.success) await sleep(AFTER_ANSWER_MS);
  return {
    name: field.name,
    status: res.success ? "filled" : "failed",
    message: res.message,
  };
}

export { BEFORE_AREA_MS, AFTER_OPEN_MS, AFTER_CALCULATE_MS, AFTER_SUBMIT_MS };
