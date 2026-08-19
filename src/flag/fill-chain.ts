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
import { setValue } from "../engine/value-setter";
import { goToSection, sectionIsRendered } from "./nav";
import { FlagField, FlagFormConfig, FlagSection, ForbiddenControl } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How long a revealed field is given to appear after its gate is answered. */
const REVEAL_TIMEOUT_MS = 3000;
const REVEAL_POLL_MS = 150;

export interface FieldOutcome {
  name: string;
  status: "filled" | "no-value" | "not-rendered" | "failed" | "refused";
  message?: string;
}

export interface SectionOutcome {
  title: string;
  reached: boolean;
  fields: FieldOutcome[];
}

export interface WalkReport {
  sections: SectionOutcome[];
  filled: number;
  failed: number;
  /** Field names present in the payload that no section of the descriptor drives. */
  unclaimed: string[];
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
  const el =
    document.querySelector(`[name="${CSS.escape(field.name)}"]`) ??
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

/** Is the input for this field on the page right now? */
function isRendered(field: FlagField): boolean {
  if (field.byId) return !!document.getElementById(field.name);
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
): Promise<FieldOutcome[]> {
  const outcomes: FieldOutcome[] = [];

  for (const field of section.fields) {
    const refusal = isForbidden(field, forbidden);
    if (refusal) {
      dbg(`  REFUSED ${field.name}: ${refusal.reason}`);
      outcomes.push({ name: field.name, status: "refused", message: refusal.reason });
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

    if (!isRendered(field)) {
      if (field.revealedBy) {
        const gate = field.revealedBy.by;
        const gateValue = values[gate];
        const gateWanted = field.revealedBy.is;
        const gateWasDriven =
          gateValue !== undefined && (!gateWanted || gateWanted.includes(gateValue));
        if (!gateWasDriven) {
          // We never answered the gate the way that reveals this, so there was
          // never anything to fill. Silent by design.
          outcomes.push({
            name: field.name,
            status: "not-rendered",
            message: `hidden — ${gate} was not answered with a revealing value`,
          });
          continue;
        }
        if (!(await waitForReveal(field))) {
          outcomes.push({
            name: field.name,
            status: "failed",
            message: `${gate} was answered but this never appeared — broken reveal`,
          });
          continue;
        }
      } else {
        outcomes.push({ name: field.name, status: "not-rendered" });
        continue;
      }
    }

    // `locate` by id when the input has no name — the worksite county.
    const spec = field.byId
      ? { name: field.name, kind: field.kind, locate: { id: field.name } }
      : { name: field.name, kind: field.kind };
    const result = await setValue(spec, value);
    outcomes.push({
      name: field.name,
      status: result.success ? "filled" : "failed",
      message: result.message,
    });
  }

  return outcomes;
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

  for (const section of config.sections) {
    dbg(`section: ${section.title}`);
    const reached = await goToSection(section);
    if (!reached) {
      sections.push({ title: section.title, reached: false, fields: [] });
      continue;
    }
    sections.push({
      title: section.title,
      reached: true,
      fields: await fillSection(section, values, config.forbidden),
    });
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
  };
}

/** Fill just the section currently on screen, if the descriptor knows it. */
export async function fillCurrentSection(
  config: FlagFormConfig,
  values: Record<string, string>,
): Promise<SectionOutcome | null> {
  const section = config.sections.find((s) => sectionIsRendered(s));
  if (!section) return null;
  return {
    title: section.title,
    reached: true,
    fields: await fillSection(section, values, config.forbidden),
  };
}
