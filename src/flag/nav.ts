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
import { FlagSection } from "./types";

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
      (f.byId && document.getElementById(f.name)),
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
