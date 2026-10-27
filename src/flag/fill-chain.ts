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
import { locateElement, setValue } from "../engine/value-setter";
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

export interface FieldOutcome {
  name: string;
  /**
   * `skipped` is a box this chain DECIDED not to type — a wage range that is
   * not a range, a box the OES calculator owns. Distinct from `refused`, which
   * is the descriptor's standing ban on a control, and from `no-value`, which
   * is the feed having nothing to say.
   */
  status: "filled" | "no-value" | "not-rendered" | "failed" | "refused" | "skipped";
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
  /** What pressing the section's Add button did, when it is a repeater. */
  row?: RowOutcome;
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
    outcomes.push({
      name: field.name,
      status: result.success ? "filled" : "failed",
      message: result.message,
    });
  }

  // Health telemetry: which questions on this section does the descriptor not cover?
  if (coverage) auditUnmappedFields(coverage, section.title);

  return outcomes;
}

/** What `runSection` did: the fields, plus the modal and the row commit. */
export interface SectionFill {
  fields: FieldOutcome[];
  modal?: ModalOutcome;
  row?: RowOutcome;
}

/**
 * Drive one whole section: its gate, its modal, its fields, then its row.
 *
 * The ORDER is the ETA-9035's Section F, and each step is there because the one
 * before it is what makes the next possible:
 *
 *   1. the prevailing-wage source. Until it says OES, there is no calculator
 *      button and no F.13a/F.13b at all;
 *   2. the OES Wage Calculator, which owns F.7, F.11, F.11a, F.13a and F.13b
 *      and writes them itself;
 *   3. the rest of the boxes, with the calculator's own boxes left alone;
 *   4. "Add Place of Employment", which commits the worksite as a ROW. Without
 *      it the section holds no rows and FLAG answers "Field F: Please enter in
 *      at least one row" — the typed boxes are an uncommitted entry form, and
 *      the page says so in a yellow banner.
 *
 * Continue is NOT pressed here. Committing the section is the caller's step, so
 * that a single-section fill can leave it to the caseworker.
 */
export async function runSection(
  section: FlagSection,
  values: Record<string, string>,
  forbidden: ForbiddenControl[],
  coverage?: Set<string>,
): Promise<SectionFill> {
  let modal: ModalOutcome | undefined;
  let owned: { names: Set<string>; reason: string } | undefined;

  if (section.modal && gateIsAnswered(section.modal.onlyWhen, values)) {
    // The gate first and on its own: the calculator button does not exist until
    // the source radio says OES, and neither do the boxes it owns.
    const gate = section.fields.find((f) => f.name === section.modal!.onlyWhen.by);
    const gateOutcome = gate
      ? await fillSection({ ...section, fields: [gate] }, values, forbidden)
      : [];
    modal = await runModal(section.modal, values);
    if (modal.status === "applied") {
      owned = {
        names: new Set(section.modal.owns),
        reason: `filled by the ${section.modal.openButton} and locked by FLAG`,
      };
    }
    const rest = await fillSection(
      { ...section, fields: section.fields.filter((f) => f !== gate) },
      values,
      forbidden,
      coverage,
      owned,
    );
    return { fields: [...gateOutcome, ...rest], ...(await commitRow(section)), modal };
  }

  const fields = await fillSection(section, values, forbidden, coverage, owned);
  return { fields, ...(await commitRow(section)) };
}

async function commitRow(section: FlagSection): Promise<{ row?: RowOutcome }> {
  if (!section.repeater) return {};
  const row = await commitRepeaterRow(section.repeater);
  dbg(`  row: ${row.status}`);
  return { row };
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
    const { fields, modal, row } = await runSection(section, values, config.forbidden, coverage);

    // Commit before moving on. A sidebar click is not a save: FLAG persists a
    // section when Continue is pressed and discards it otherwise, so a walk
    // that only navigated would leave every section it typed behind it empty.
    const commit = await commitSection();
    sections.push({ title: section.title, reached: true, fields, commit, modal, row });

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
): Promise<SectionOutcome | null> {
  const section = config.sections.find((s) => sectionIsRendered(s));
  if (!section) return null;
  const coverage = new Set(flagFieldNames(config.sections).map(normalizeName));
  const { fields, modal, row } = await runSection(section, values, config.forbidden, coverage);
  return { title: section.title, reached: true, fields, modal, row };
}
