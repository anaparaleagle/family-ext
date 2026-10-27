// ===========================================================================
// FLAG SECTION NAVIGATION.
//
// FLAG keeps one URL for the whole application and moves between sections by
// sidebar click, so there is no pathname to match and no slug to detect. This
// module is the whole of "where am I, and how do I get to section X".
//
// Two things the capture runs taught this file, both the hard way:
//
//   * A SIDEBAR CLICK IS NOT A COMMIT. FLAG persists a section when you press
//     Continue, not when you navigate away from it. So the walk fills a section
//     and then commits it, and `advance` is a separate, explicit step — never a
//     side effect of navigating to the next one.
//   * NOT EVERY SIDEBAR-LOOKING LINK IS A SECTION. The same query that finds the
//     section list also finds Cases, Profiles and My Network, which are the
//     global site nav. Clicking one leaves the form entirely. Candidates are
//     therefore matched against the descriptor's own section labels, never
//     accepted just because they were in a <nav>.
// ===========================================================================

import { dbg } from "../engine/logger";
import { locateElement } from "../engine/value-setter";
import { FlagRepeaterSpec, FlagSection, flagFieldSpec } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How long a section change is given to render before it is called a failure. */
const NAV_TIMEOUT_MS = 8000;
const POLL_MS = 200;

export function normalise(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Does this sidebar entry point at `section`?
 *
 * Substring, because FLAG concatenates the section letter onto the title in its
 * own markup — the entry for "Employer Information" reads
 * "CEmployer Information", and on the 9089 "F.aWorksite Information". Matching
 * the title as a substring tolerates that without hard-coding the letters, which
 * differ between the two forms for the same section.
 */
export function matchesSection(entryText: string, section: FlagSection): boolean {
  return normalise(entryText).includes(normalise(section.navLabel));
}

const NAV_SELECTOR =
  "nav a, nav button, nav li, aside a, aside li, [class*='sidebar'] a," +
  " [class*='sidebar'] li, [class*='stepper'] li, [role='tablist'] [role='tab']";

/**
 * The clickable sidebar entry for `section`, or null.
 *
 * Re-queried on every call rather than cached: FLAG re-renders the sidebar on
 * each section change, so an element reference held across one hop is detached
 * and clicking it does nothing at all.
 */
export function findSectionLink(section: FlagSection): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(NAV_SELECTOR);
  let best: HTMLElement | null = null;
  let bestLength = Infinity;
  for (const el of candidates) {
    const text = el.textContent ?? "";
    if (text.length > 120) continue; // a container, not a link
    if (!matchesSection(text, section)) continue;
    // Prefer the SHORTEST match. The sidebar nests: an <li> wrapping the whole
    // list also contains the text of the section we want, and clicking the
    // wrapper does nothing.
    if (text.trim().length < bestLength) {
      best = el;
      bestLength = text.trim().length;
    }
  }
  return best;
}

/** A cheap fingerprint of what is rendered, used to detect that a nav took effect. */
function fingerprint(): string {
  const names = [...document.querySelectorAll("input[name], select[name], textarea[name]")]
    .map((el) => el.getAttribute("name"))
    .join("|");
  const heading = normalise(document.querySelector("h1, h2, legend")?.textContent);
  return `${heading}##${names}`;
}

/**
 * Is `section` the one on screen?
 *
 * By rendered fields, not by heading text: the heading is FLAG's and may be
 * shared or reworded, whereas a field name is the thing the fill actually needs
 * to be true. A section with no fields at all cannot be confirmed this way, so it
 * reports false and the caller treats it as "nothing to do".
 */
export function sectionIsRendered(section: FlagSection): boolean {
  if (!section.fields.length) return false;
  return section.fields.some(
    (f) =>
      document.querySelector(`[name="${CSS.escape(f.name)}"]`) ||
      (f.byId && document.getElementById(f.name)) ||
      (f.byLabel && locateElement(flagFieldSpec(f))),
  );
}

/**
 * Click through to `section` and wait for it to actually render.
 *
 * Resolves false rather than throwing on every failure — no link, click had no
 * effect, section never appeared. The walk logs it and moves on, because one
 * unreachable section must not cost the other nine.
 */
export async function goToSection(section: FlagSection): Promise<boolean> {
  if (sectionIsRendered(section)) return true;

  const link = findSectionLink(section);
  if (!link) {
    dbg(`nav: no sidebar entry matching "${section.navLabel}"`);
    return false;
  }

  const before = fingerprint();
  link.click();

  const deadline = Date.now() + NAV_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (sectionIsRendered(section)) return true;
    // An empty conditional section will never satisfy sectionIsRendered, so
    // accept "the page changed" as arrival for those and let the field loop
    // find nothing.
    if (!section.fields.length && fingerprint() !== before) return true;
  }
  dbg(`nav: "${section.navLabel}" did not render within ${NAV_TIMEOUT_MS}ms`);
  return false;
}

/**
 * Commit the section on screen by pressing FLAG's own Continue.
 *
 * Deliberately NEVER presses Submit, Sign, Certify, Delete, Withdraw or Pay. The
 * extension fills a form; a person files it. This is also the guard that stops a
 * walk from accidentally submitting an application to DOL, which has no undo.
 */
const COMMIT_LABELS = ["continue", "save & continue", "next"];
const NEVER_CLICK = /\b(submit|sign|certify|declare|delete|withdraw|pay|payment)\b/i;

export function findCommitButton(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("button, [role='button'], input[type='submit']")) {
    const text = normalise(el.textContent || (el as HTMLInputElement).value);
    if (!text || NEVER_CLICK.test(text)) continue;
    if (COMMIT_LABELS.includes(text)) return el;
  }
  return null;
}

/** What pressing Continue did. `blocked` is FLAG refusing the section, which is
 * a RESULT and not an error: the page stays put and says which box it wants. */
export type CommitOutcome = "committed" | "blocked" | "no-button";

/**
 * Press Continue and wait for FLAG to move.
 *
 * The page not changing is how FLAG reports a validation failure — it re-renders
 * the same section with "This field is required." against the boxes it wants. So
 * an unchanged fingerprint is reported as `blocked` and the walk stops rather
 * than pressing on: every later section would be filled into a form whose
 * earlier half was never saved, and the report would claim otherwise.
 */
export async function commitSection(): Promise<CommitOutcome> {
  const button = findCommitButton();
  if (!button) {
    dbg("commit: no Continue button on this section");
    return "no-button";
  }

  const before = fingerprint();
  button.click();

  const deadline = Date.now() + NAV_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (fingerprint() !== before) return "committed";
  }
  dbg(`commit: page unchanged ${NAV_TIMEOUT_MS}ms after Continue — FLAG refused it`);
  return "blocked";
}

// ── buttons, modals and repeater rows ───────────────────────────────────────

const CLICKABLE = "button, [role='button'], a, input[type='button'], input[type='submit']";

/**
 * The button whose visible text contains `text`, inside `scope`.
 *
 * Text, not a selector, because FLAG's own markup for these controls has
 * already been redesigned once under the H-1B extension — the labels on the
 * screen outlived the ids and classes behind them.
 *
 * The SHORTEST match wins, for the same reason the sidebar search takes the
 * shortest: a container that wraps the button also contains its text.
 */
export function findButtonByText(text: string, scope: ParentNode = document): HTMLElement | null {
  const want = normalise(text);
  let best: HTMLElement | null = null;
  let bestLength = Infinity;
  for (const el of scope.querySelectorAll<HTMLElement>(CLICKABLE)) {
    const label = normalise(el.textContent || (el as HTMLInputElement).value);
    if (!label || !label.includes(want)) continue;
    if (NEVER_CLICK_BUTTON.test(label)) continue;
    if (label.length < bestLength) {
      best = el;
      bestLength = label.length;
    }
  }
  return best;
}

/**
 * Buttons this file will not press whatever a descriptor asks for.
 *
 * "Submit" is NOT here, and that is the one judgement call: the OES Wage
 * Calculator's own apply button is labelled Submit, and refusing it would mean
 * never being able to use the calculator at all. The application's Submit is
 * "Review & Submit" and is caught by `review`; a modal search is also scoped to
 * the open dialog, so the page's own buttons are out of reach of it.
 */
const NEVER_CLICK_BUTTON = /\b(review|sign|certify|declare|delete|withdraw|pay|payment)\b/i;

/** Is this control disabled — by the property, the attribute, or ARIA? */
export function isDisabled(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.hasAttribute("disabled")) return true;
  return el.getAttribute("aria-disabled") === "true";
}

/** The open modal over the page, if there is one. */
export function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="dialog"]:not([aria-hidden="true"]), .modal.show, .modal[style*="display: block"]',
  );
}

/**
 * How many rows the repeater's table already holds.
 *
 * Read off FLAG's own heading — "0 Entries for Place of Employment" — because
 * it is the page stating the fact, not us inferring it from markup that could
 * change. -1 when the heading is not on screen at all, which is reported
 * separately from "the count did not go up": one is a page we no longer
 * understand, the other is a row FLAG refused.
 */
export function repeaterRowCount(repeater: FlagRepeaterSpec): number {
  const want = normalise(repeater.entriesLabel);
  let best = -1;
  let bestLength = Infinity;
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    const text = normalise(el.textContent);
    if (!text.includes(want) || text.length > bestLength) continue;
    // "0 Entries for Place of Employment" is what the live page prints. The
    // trailing form is accepted too so a DOL reword to "Places of Employment
    // (1)" does not read as a page we no longer understand.
    const label = escapeRegExp(want);
    const match =
      text.match(new RegExp(`(\\d+)\\s+${label}`)) ??
      text.match(new RegExp(`${label}[^0-9]{0,4}(\\d+)`));
    if (!match) continue;
    best = Number(match[1]);
    bestLength = text.length;
  }
  return best;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The validation messages FLAG is showing right now, as a person would read them.
 *
 * Only used in reporting. When "Add Place of Employment" is disabled, the page
 * has already listed exactly which boxes it is unhappy with, and repeating that
 * in the toolbar is the difference between "the row was not added" and knowing
 * why without opening the console.
 */
export function visibleErrors(limit = 6): string[] {
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>(
    '[role="alert"], .usa-error-message, [class*="error-message"], [class*="errorMessage"]',
  )) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length < 200) seen.add(text);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** What pressing the repeater's Add button did. */
export type RowOutcome =
  | { status: "added"; rows: number }
  | { status: "disabled"; errors: string[] }
  | { status: "refused"; rows: number; errors: string[] }
  | { status: "no-button" };

/** How long FLAG is given to show the committed row in its table. */
const ROW_TIMEOUT_MS = 5000;

/**
 * Commit the typed row with the section's own Add button.
 *
 * This is the step that was missing, and it is not Continue: on the ETA-9035
 * Continue saves the SECTION, while Add saves the ROW, and a section saved with
 * no rows is the error "Field F: Please enter in at least one row."
 *
 * A disabled button is reported, never forced. FLAG disables it while the entry
 * fails validation, and a click on a disabled button does nothing at all — so
 * without this check the walk would report a committed worksite that does not
 * exist.
 */
export async function commitRepeaterRow(repeater: FlagRepeaterSpec): Promise<RowOutcome> {
  const button = findButtonByText(repeater.addButtonText);
  if (!button) {
    dbg(`row: no "${repeater.addButtonText}" button on this section`);
    return { status: "no-button" };
  }
  if (isDisabled(button)) {
    const errors = visibleErrors();
    dbg(`row: "${repeater.addButtonText}" is disabled — ${errors.join(" | ") || "no message shown"}`);
    return { status: "disabled", errors };
  }

  const before = repeaterRowCount(repeater);
  button.click();

  const deadline = Date.now() + ROW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const now = repeaterRowCount(repeater);
    if (now > before) return { status: "added", rows: now };
  }
  const rows = repeaterRowCount(repeater);
  dbg(`row: table still reads ${rows} after "${repeater.addButtonText}"`);
  return { status: "refused", rows, errors: visibleErrors() };
}
