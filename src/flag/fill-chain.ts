// ===========================================================================
// THE FLAG WALK — fill one section, or every section, of a DOL form.
//
// The engine (engine/value-setter) does the actual DOM work and is shared with
// the myUSCIS side: it was harvested from the H-1B extension's I-129 filler and
// is a generic "commit a value to a React-controlled input selected by [name]"
// waterfall. FLAG's inputs are React-controlled and have stable `name`
// attributes, so it applies unchanged. This file is ordering, reveals, refusals
// and reporting.
//
// WHAT IT WILL NOT DO
//   * touch a control the descriptor forbids — the profile pickers, which
//     repopulate a whole section from DOL's stored copy and would silently
//     overwrite everything we typed;
//   * press Submit / Sign / Certify / Delete / Withdraw / Pay (see nav.ts);
//   * invent a value. Values come from the backend feed already coded to the
//     exact strings this form's widgets accept.
// ===========================================================================

import { dbg } from "../engine/logger";
import { LOCKED_MESSAGE, locateElement, setValue } from "../engine/value-setter";
import { auditUnmappedFields, normalizeName } from "../engine/telemetry";
import {
  CommitOutcome,
  RowOutcome,
  commitRepeaterRow,
  commitSection,
  goToSection,
  sectionIsRendered,
} from "./nav";
import { ModalOutcome, runModal } from "./modal";
import {
  FlagField,
  FlagFormConfig,
  FlagRepeaterSpec,
  FlagSection,
  ForbiddenControl,
  flagFieldNames,
  flagFieldSpec,
  gateIsAnswered,
  revealGates,
} from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How long a revealed field is given to appear after its gate is answered. */
const REVEAL_TIMEOUT_MS = 3000;
const REVEAL_POLL_MS = 150;

// The H-1B extension's own waits for Section F, kept to the millisecond.
/** After a country or state answer, whose dependent list FLAG rebuilds. */
const ADDRESS_SETTLE_MS = 1500;
/** Before re-attempting the boxes that were not on the page the first time. */
const RETRY_WAIT_MS = 3000;
/** After re-answering a unit radio that drifted. */
const REASSERT_SETTLE_MS = 300;
/** After the prevailing-wage source is answered, for its dependent block
 * (and the calculator's button) to render. */
const AFTER_GATE_MS = 2000;
/** Before pressing Add for a row, and after it is committed. */
const BEFORE_ADD_MS = 500;
const AFTER_ADD_MS = 1500;
/** After the table has taken a row and the next worksite's boxes are blank. */
const BETWEEN_ROWS_MS = 2000;

/**
 * Does answering this field rebuild the options of the one below it?
 *
 * Country filters state, state filters county. Matched on the name rather than
 * declared per field, which is how the old extension decided it too.
 */
function rebuildsDependents(field: FlagField): boolean {
  if (field.kind !== "select" && field.kind !== "search") return false;
  const name = field.name.toLowerCase();
  return name.includes("country") || name.includes("state");
}

export interface FieldOutcome {
  name: string;
  /**
   * `skipped` is a box this chain DECIDED not to type — a wage range that is
   * not a range, a box the OES calculator owns. Distinct from `refused`, which
   * is the descriptor's standing ban on a control, and from `no-value`, which
   * is the feed having nothing to say.
   *
   * `locked` is the PAGE's decision, not ours: FLAG renders the control
   * disabled, so there is nothing we could have done. It was reported as
   * `failed` until 2026-10-28, which read as a bug in the extension — the live
   * ETA-9035E run listed `_section_f_f8_work_state_id` and
   * `_section_f_f10a_nonimmigrant_wage_per` as failures when both were simply
   * greyed out, waiting on an OES Wage Calculator that never produced a wage.
   */
  status:
    | "filled"
    | "no-value"
    | "not-rendered"
    | "failed"
    | "refused"
    | "skipped"
    | "locked";
  message?: string;
}

export interface SectionOutcome {
  title: string;
  reached: boolean;
  fields: FieldOutcome[];
  /** What pressing Continue did. Absent when the walk did not try to commit. */
  commit?: CommitOutcome;
  /** What the section's modal did, when it has one. */
  modal?: ModalOutcome;
  /** What each press of the section's Add button did, when it is a repeater. */
  rows?: RowOutcome[];
}

export interface WalkReport {
  sections: SectionOutcome[];
  filled: number;
  failed: number;
  /** Field names present in the payload that no section of the descriptor drives. */
  unclaimed: string[];
  /** The section FLAG refused, if the walk stopped on one. */
  blockedAt?: string;
}

/**
 * Is this field one the descriptor forbids touching?
 *
 * Checked against the ELEMENT as well as the name, because the profile pickers
 * are unnamed comboboxes — their only stable handles are an id and a visible
 * label, and a descriptor entry that only blocked a `name` would not stop them.
 */
export function isForbidden(
  field: FlagField,
  forbidden: ForbiddenControl[],
): ForbiddenControl | null {
  const haystacks = [field.name.toLowerCase()];
  // A label-located field is checked on the element the label resolved to, so
  // a label that lands on a profile picker is refused by the picker's id.
  const el = field.byLabel
    ? locateElement(flagFieldSpec(field))
    : document.querySelector(`[name="${CSS.escape(field.name)}"]`) ??
      document.getElementById(field.name);
  if (el) {
    haystacks.push((el.id || "").toLowerCase());
    haystacks.push((el.getAttribute("aria-label") || "").toLowerCase());
  }
  for (const rule of forbidden) {
    const needle = rule.match.toLowerCase();
    if (haystacks.some((h) => h && h.includes(needle))) return rule;
  }
  return null;
}

/** An amount as a number, or NaN. Mirrors the money reader in the value-setter. */
function amount(value: string | undefined): number {
  return Number((value ?? "").replace(/[^0-9.]/g, ""));
}

/**
 * Is `value` strictly above `floor`, both read as money?
 *
 * False when either is missing or unreadable, which is the safe answer: the
 * box is then left alone and the caseworker types the range if there is one.
 */
function exceeds(value: string, floor: string | undefined): boolean {
  const a = amount(value);
  const b = amount(floor);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if ((floor ?? "").trim() === "") return false;
  return a > b;
}

/** Is the input for this field on the page right now? */
function isRendered(field: FlagField): boolean {
  if (field.byId) return !!document.getElementById(field.name);
  if (field.byLabel) return !!locateElement(flagFieldSpec(field));
  return !!document.querySelector(`[name="${CSS.escape(field.name)}"]`);
}

/**
 * Wait for a revealed field, having first made sure its gate was answered.
 *
 * The distinction this draws is the point of `revealedBy`. A field whose gate we
 * never had a value for could not possibly have been revealed, so its absence is
 * expected and silent. A field whose gate we DID answer and which still did not
 * appear is a broken reveal, and that stays loud — it is how a FLAG redesign gets
 * noticed instead of quietly halving the fill.
 *
 * Several gates mean OR: one revealing answer is enough. Reading them as AND
 * would put the ETA-9035's H.3 back where it started, hidden on every employer
 * that is a willful violator without also being H-1B dependent.
 */
async function waitForReveal(field: FlagField): Promise<boolean> {
  const deadline = Date.now() + REVEAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isRendered(field)) return true;
    await sleep(REVEAL_POLL_MS);
  }
  return false;
}

/**
 * Fill one section. Assumes it is already on screen.
 *
 * Fields are driven in descriptor order, which puts each gate before the fields
 * it reveals. That ordering is not cosmetic: the whole of Section D renders only
 * once the representation radio says Attorney or Agent, so an alphabetical or
 * payload-order pass would report fifteen missing inputs that were never given a
 * chance to exist.
 */
/**
 * One attempt's result, as an outcome — separating what FLAG would not let us
 * do from what we could not do.
 *
 * A disabled control is not a failure of the fill. Saying so matters because
 * the toolbar's "N failed" line is the only thing a caseworker reads: two
 * greyed-out boxes listed as failures sent a live ETA-9035E run looking for a
 * bug in the extension when the page was simply waiting on its own calculator.
 */
function classify(
  field: FlagField,
  result: { success: boolean; message: string },
  lockedReason?: string,
): FieldOutcome {
  if (result.success) return { name: field.name, status: "filled", message: result.message };
  if (result.message === LOCKED_MESSAGE) {
    return {
      name: field.name,
      status: "locked",
      message: lockedReason ? `${LOCKED_MESSAGE} — ${lockedReason}` : LOCKED_MESSAGE,
    };
  }
  return { name: field.name, status: "failed", message: result.message };
}

export async function fillSection(
  section: FlagSection,
  values: Record<string, string>,
  forbidden: ForbiddenControl[],
  // When passed, health telemetry records rendered questions on this section
  // whose name isn't in the descriptor's coverage set.
  coverage?: Set<string>,
  // Boxes another step of the section owns — the OES calculator's, once it has
  // run. Reported as `skipped` with this reason rather than typed over.
  owned?: { names: Set<string>; reason: string },
  // Why a control FLAG has disabled is disabled, when this section knows. On
  // Section F that is the OES Wage Calculator, which FLAG hands the whole wage
  // block to the moment F.12/13/14 says OES.
  lockedReason?: string,
): Promise<FieldOutcome[]> {
  const outcomes: FieldOutcome[] = [];

  for (const field of section.fields) {
    const refusal = isForbidden(field, forbidden);
    if (refusal) {
      dbg(`  REFUSED ${field.name}: ${refusal.reason}`);
      outcomes.push({ name: field.name, status: "refused", message: refusal.reason });
      continue;
    }

    if (owned?.names.has(field.name)) {
      dbg(`  SKIPPED ${field.name}: ${owned.reason}`);
      outcomes.push({ name: field.name, status: "skipped", message: owned.reason });
      continue;
    }

    const value = values[field.name];
    if (value === undefined || value === "") {
      // Nothing to type. Not a failure: about half of both forms is boxes the
      // backend map documents as having no source, plus every standing default
      // the map deliberately leaves for a caseworker.
      outcomes.push({ name: field.name, status: "no-value" });
      continue;
    }

    if (field.onlyAbove) {
      const floor = values[field.onlyAbove];
      if (!exceeds(value, floor)) {
        const reason =
          `not typed: ${amount(value)} is not above ${field.onlyAbove} ` +
          `(${amount(floor)}), and FLAG requires the To wage to be higher than the From`;
        dbg(`  SKIPPED ${field.name}: ${reason}`);
        outcomes.push({ name: field.name, status: "skipped", message: reason });
        continue;
      }
    }

    if (!isRendered(field)) {
      const gates = revealGates(field);
      if (gates.length) {
        const named = gates.map((g) => g.by).join(" or ");
        const anyGateDriven = gates.some((gate) => {
          const gateValue = values[gate.by];
          return gateValue !== undefined && (!gate.is || gate.is.includes(gateValue));
        });
        if (!anyGateDriven) {
          // We never answered any gate the way that reveals this, so there was
          // never anything to fill. Silent by design.
          outcomes.push({
            name: field.name,
            status: "not-rendered",
            message: `hidden — ${named} was not answered with a revealing value`,
          });
          continue;
        }
        if (!(await waitForReveal(field))) {
          outcomes.push({
            name: field.name,
            status: "failed",
            message: `${named} was answered but this never appeared — broken reveal`,
          });
          continue;
        }
      } else {
        outcomes.push({ name: field.name, status: "not-rendered" });
        continue;
      }
    }

    // `locate` by id or box label when the input has no name.
    const result = await setValue(flagFieldSpec(field), value);
    outcomes.push(classify(field, result, lockedReason));

    // A country or a state REBUILDS the list below it — FLAG filters its
    // states by country and its counties by state — and the dependent box is
    // already on the page, so the reveal poll has nothing to wait for. The old
    // extension paused here for exactly this, and without it the next field is
    // answered against a list that is about to be replaced.
    if (result.success && rebuildsDependents(field)) await sleep(ADDRESS_SETTLE_MS);
  }

  // The old extension's step 7b, by its own rule: a unit radio can be reset by
  // a wage amount typed after it, so the ones marked `reassert` are checked
  // once everything else is in and re-answered if they drifted.
  for (const field of section.fields) {
    if (!field.reassert) continue;
    const want = values[field.name];
    if (!want || owned?.names.has(field.name)) continue;
    const checked = document.querySelector<HTMLInputElement>(
      `input[name="${CSS.escape(field.name)}"]:checked`,
    );
    if (checked && checked.value.toLowerCase() === want.toLowerCase()) continue;
    dbg(`  re-asserting ${field.name} -> "${want}" (was "${checked?.value ?? "unset"}")`);
    const again = await setValue(flagFieldSpec(field), want);
    await sleep(REASSERT_SETTLE_MS);
    const outcome = outcomes.find((o) => o.name === field.name);
    if (!outcome) continue;
    if (again.success) {
      outcome.message = `${outcome.message ?? ""} (re-asserted)`.trim();
      continue;
    }
    // It ran and FLAG dropped it. On the OES branch that is the ordinary
    // answer for F.10a — the calculator owns the wage unit and FLAG greys the
    // radios out until it has applied one — and the old step 7b had no way to
    // say so, which is how a correct refusal read as a failed field.
    dbg(`  ${field.name} would not re-assert: ${again.message}`);
    Object.assign(outcome, classify(field, again, lockedReason));
  }

  // RETRY, once, for a box that WAS on the page and then could not be written.
  // The old extension waited 3s and re-attempted everything that came back
  // "Element not found" — FLAG re-renders a section after an answer, and a box
  // that vanishes mid-pass is not a box that is missing.
  //
  // Scoped exactly as the old pass was: a field never rendered at all is NOT
  // retried. It was skipped before anything was attempted, the reveal rules
  // above already decided whether that is expected, and re-waiting 3s for each
  // one would add a minute to a form that is half conditional.
  const retryable = outcomes
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.status === "failed" && o.message === "element not on page");
  if (retryable.length) {
    await sleep(RETRY_WAIT_MS);
    for (const { o, index } of retryable) {
      const field = section.fields.find((f) => f.name === o.name);
      const value = field && values[field.name];
      if (!field || !value || !isRendered(field)) continue;
      const again = await setValue(flagFieldSpec(field), value);
      if (!again.success) continue;
      dbg(`  ${field.name} filled on the retry pass`);
      outcomes[index] = { name: field.name, status: "filled", message: `${again.message} (retry)` };
    }
  }

  // Health telemetry: which questions on this section does the descriptor not cover?
  if (coverage) auditUnmappedFields(coverage, section.title);

  return outcomes;
}

/** What `runSection` did: the fields, plus the modal and the row commit. */
export interface SectionFill {
  fields: FieldOutcome[];
  modal?: ModalOutcome;
  /**
   * What each press of the repeater's Add button did — one per worksite, in
   * the order they were typed. Absent on a section that is not a repeater, and
   * on one where nothing was typed at all.
   */
  rows?: RowOutcome[];
}

/** One extra worksite, as FLAG field names and values. */
export type RowValues = Record<string, string>;

/**
 * Drive one whole section: its gate, its modal, its fields, then its rows.
 *
 * The ORDER is the H-1B extension's Section F flow, step for step, because
 * each step is what makes the next possible:
 *
 *   1. the prevailing-wage source. Until it says OES, there is no calculator
 *      button and no F.13a/F.13b at all;
 *   2. the OES Wage Calculator, which owns F.7, F.11, F.11a, F.13a and F.13b
 *      and writes them itself on Submit;
 *   3. the rest of the boxes, with the calculator's own left alone, and the
 *      offered-wage unit re-checked at the end (step 7b);
 *   4. "Add Place of Employment", which commits the worksite as a ROW. Without
 *      it the section holds no rows and FLAG answers "Field F: Please enter in
 *      at least one row" — the typed boxes are an uncommitted entry form, and
 *      the page says so in a yellow banner;
 *   5. then once more per EXTRA worksite: the same boxes with the address
 *      replaced, the calculator re-run for that county, and Add again. FLAG
 *      clears the entry form after each commit and re-disables the dependent
 *      radios, so a second worksite is a full second pass, not a patch.
 *
 * Continue is NOT pressed here. Committing the SECTION is the caller's step, so
 * a single-section fill can leave it to the caseworker.
 */
export async function runSection(
  section: FlagSection,
  values: Record<string, string>,
  forbidden: ForbiddenControl[],
  coverage?: Set<string>,
  /** Worksites past the first. Ignored by a section with no repeater. */
  extraRows?: RowValues[],
): Promise<SectionFill> {
  const first = await driveSection(section, values, forbidden, coverage);
  if (!section.repeater) return first;

  // Old step 8's own condition: nothing typed, nothing to commit. Pressing Add
  // on an untouched form would only add FLAG's validation errors to the page.
  if (!first.fields.some((f) => f.status === "filled")) {
    dbg("  row: nothing was typed into this section — not pressing Add");
    return first;
  }

  const rows: RowOutcome[] = [await addRow(section.repeater)];
  const fields = [...first.fields];

  for (const patch of extraRows ?? []) {
    if (rows[rows.length - 1].status !== "added") {
      // The row before this one did not take. Typing the next worksite over
      // the same boxes would lose it and report the one after as the only
      // worksite on the application.
      dbg("  row: the previous worksite was not committed — stopping");
      break;
    }
    await sleep(BETWEEN_ROWS_MS);
    const next = { ...values, ...rowPatch(section.repeater, patch) };
    const again = await driveSection(section, next, forbidden);
    fields.push(...again.fields);
    rows.push(await addRow(section.repeater));
  }

  return { fields, modal: first.modal, rows };
}

/** One pass over the section's own boxes: gate, modal, the rest. */
async function driveSection(
  section: FlagSection,
  values: Record<string, string>,
  forbidden: ForbiddenControl[],
  coverage?: Set<string>,
): Promise<SectionFill> {
  if (!section.modal || !gateIsAnswered(section.modal.onlyWhen, values)) {
    return { fields: await fillSection(section, values, forbidden, coverage) };
  }

  // The gate first and ON ITS OWN, then a pause: the calculator's button does
  // not exist until the source radio says OES, and neither do the boxes it
  // owns. The old flow waited 2s here for the button to appear.
  const gate = section.fields.find((f) => f.name === section.modal!.onlyWhen.by);
  const gateOutcome = gate
    ? await fillSection({ ...section, fields: [gate] }, values, forbidden)
    : [];
  if (gateOutcome.some((o) => o.status === "filled")) await sleep(AFTER_GATE_MS);

  const modal = await runModal(section.modal, values);
  // The calculator owns its boxes whenever it OPENED, not only when it worked.
  // FLAG disables them the moment the source radio says OES, so a calculator
  // that produced no wage — or could not even run, because Calculate stayed
  // greyed out — leaves them disabled and empty. Typing the case's own annual
  // PWD into F.11 behind its back is exactly the overwrite the old extension
  // stopped doing, and it is no safer when the calculator failed.
  const ran =
    modal.status === "applied" ||
    modal.status === "no-result" ||
    modal.status === "cannot-calculate";
  const owned = ran
    ? {
        names: new Set(section.modal.owns),
        reason: `filled by the ${section.modal.openButton} and locked by FLAG`,
      }
    : undefined;
  // Why anything ELSE on this section may be greyed out. The calculator does
  // not only own the five boxes it writes: picking the OES branch hands FLAG
  // the whole wage block, and on the live run of 2026-10-27 the worksite State
  // and the offered-wage unit were disabled with it.
  const lockedReason = ran
    ? `FLAG hands this to the ${section.modal.openButton} on the OES branch` +
      (modal.status === "applied" ? "" : ", and it produced no wage")
    : undefined;

  const rest = await fillSection(
    { ...section, fields: section.fields.filter((f) => f !== gate) },
    values,
    forbidden,
    coverage,
    owned,
    lockedReason,
  );
  return { fields: [...gateOutcome, ...rest], modal };
}

/** Press the repeater's Add, with the old flow's waits around it. */
async function addRow(repeater: FlagRepeaterSpec): Promise<RowOutcome> {
  await sleep(BEFORE_ADD_MS);
  const row = await commitRepeaterRow(repeater);
  dbg(`  row: ${row.status}`);
  await sleep(AFTER_ADD_MS);
  return row;
}

/**
 * One worksite's boxes, and ONLY those.
 *
 * Every other value on the section — the wages, the source, the worker count —
 * is carried forward unchanged, which is what the old extension's patch did.
 *
 * A box this row does not name is set to "", which the fill reads as "nothing
 * to type" and leaves alone. That is right only because FLAG clears the entry
 * form when a row is committed; if a redesign ever stopped clearing it, the
 * previous worksite's suite number would ride along into the next one. The old
 * extension passed "" here for the same reason and with the same dependency.
 */
function rowPatch(repeater: FlagRepeaterSpec, row: RowValues): Record<string, string> {
  return Object.fromEntries(repeater.rowFields.map((name) => [name, row[name] ?? ""]));
}

/**
 * Walk every section of the form.
 *
 * A section that cannot be reached costs only itself. That matters more here than
 * on myUSCIS: eight of the ETA-9089's sections render nothing until an upstream
 * answer has been committed, and an aborting walk would turn one of those into a
 * form that is half typed with no record of where it stopped.
 */
export async function fillAll(
  config: FlagFormConfig,
  values: Record<string, string>,
  extraRows?: RowValues[],
): Promise<WalkReport> {
  const sections: SectionOutcome[] = [];
  const coverage = new Set(flagFieldNames(config.sections).map(normalizeName));

  let blockedAt: string | undefined;

  for (const section of config.sections) {
    dbg(`section: ${section.title}`);
    const reached = await goToSection(section);
    if (!reached) {
      sections.push({ title: section.title, reached: false, fields: [] });
      continue;
    }
    const { fields, modal, rows } = await runSection(
      section, values, config.forbidden, coverage, extraRows,
    );

    // Commit before moving on. A sidebar click is not a save: FLAG persists a
    // section when Continue is pressed and discards it otherwise, so a walk
    // that only navigated would leave every section it typed behind it empty.
    const commit = await commitSection();
    sections.push({ title: section.title, reached: true, fields, commit, modal, rows });

    if (commit === "blocked") {
      // FLAG is holding this section over a box it wants. Pressing on would
      // type the rest of the form on top of an unsaved one and report success.
      blockedAt = section.title;
      dbg(`walk: stopped at "${section.title}" — FLAG would not take it`);
      break;
    }
  }

  const all = sections.flatMap((s) => s.fields);
  const driven = new Set(config.sections.flatMap((s) => s.fields.map((f) => f.name)));
  return {
    sections,
    filled: all.filter((f) => f.status === "filled").length,
    failed: all.filter((f) => f.status === "failed").length,
    // A payload key no section drives. Either the descriptor is behind the
    // backend table, or the feed grew a field — both worth saying out loud
    // rather than dropping the value on the floor.
    unclaimed: Object.keys(values).filter((k) => !driven.has(k)),
    blockedAt,
  };
}

/** Fill just the section currently on screen, if the descriptor knows it. */
export async function fillCurrentSection(
  config: FlagFormConfig,
  values: Record<string, string>,
  extraRows?: RowValues[],
): Promise<SectionOutcome | null> {
  const section = config.sections.find((s) => sectionIsRendered(s));
  if (!section) return null;
  const coverage = new Set(flagFieldNames(config.sections).map(normalizeName));
  const { fields, modal, rows } = await runSection(
    section, values, config.forbidden, coverage, extraRows,
  );
  return { title: section.title, reached: true, fields, modal, rows };
}
