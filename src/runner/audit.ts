// "Audit page": compare what the descriptor EXPECTS on the current page against
// what the live DOM actually carries.
//
// Why this exists: myUSCIS renames Formik fields, reorders pages, and reshuffles
// slugs between releases. Today a rename surfaces only as a silent "0/N filled"
// buried in the log — indistinguishable from "this case has no data for that
// page". This turns that into an explicit, on-demand answer:
//
//   present  — descriptor field names found in the DOM (the descriptor is right)
//   missing  — descriptor names NOT in the DOM (renamed/removed, OR a legitimate
//              conditional/repeater absence — see `notes`)
//   extra    — Formik-looking names in the DOM the descriptor never mentions
//              (a NEW field USCIS added, or page chrome)
//
// It is a read-only diagnostic: it never sets a value and never navigates.

import { FormPage } from "./types";

export interface PageAudit {
  slug: string;
  title: string;
  present: string[];
  missing: string[];
  extra: string[];
  /** Human-readable caveats explaining why `missing`/`extra` may be benign. */
  notes: string[];
}

/** Collect every named input/select/textarea name on the page. */
function domFieldNames(doc: Document): string[] {
  const names = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("input, select, textarea"))) {
    const name = el.getAttribute("name");
    // Radios share one name across their options — the Set collapses them.
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * A descriptor name matches a DOM name when they are equal, or — for a repeater
 * template — when the DOM name is any indexed instance of it. So
 * `foo.{i}.city` matches `foo.0.city` AND `foo.7.city`.
 */
function matcherFor(descriptorName: string): (domName: string) => boolean {
  if (!descriptorName.includes("{i}")) return (domName) => domName === descriptorName;
  const pattern = new RegExp(
    "^" +
      descriptorName
        .split("{i}")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\d+") +
      "$",
  );
  return (domName) => pattern.test(domName);
}

/**
 * Audit the current page against its descriptor entry.
 *
 * Repeater `{i}` fields render no inputs until "Add" is clicked, and
 * conditional fields render only once an upstream answer reveals them — both
 * are legitimately absent on a fresh page, so we annotate rather than cry wolf.
 */
export function auditPage(page: FormPage, doc: Document = document): PageAudit {
  const domNames = domFieldNames(doc);
  const present: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];

  for (const field of page.fields) {
    const matches = matcherFor(field.name);
    if (domNames.some(matches)) present.push(field.name);
    else missing.push(field.name);
  }

  // Anything on the page the descriptor does not account for. Names without a
  // dot are page chrome (search boxes, pagination) rather than Formik paths, so
  // they'd be pure noise here.
  const claimed = page.fields.map((f) => matcherFor(f.name));
  const extra = domNames.filter((n) => n.includes(".") && !claimed.some((m) => m(n)));

  if (missing.some((n) => n.includes("{i}"))) {
    notes.push(
      'Repeater rows render only after "Add" is clicked — missing {i} fields are ' +
        "expected until a row exists.",
    );
  }
  const missingConditional = page.fields.filter(
    (f) => f.conditional && missing.includes(f.name),
  );
  if (missingConditional.length > 0) {
    notes.push(
      `${missingConditional.length} missing field(s) are conditional reveals — expected ` +
        "absent until the upstream answer is set.",
    );
  }
  const hardMissing = missing.filter(
    (n) => !n.includes("{i}") && !page.fields.find((f) => f.name === n)?.conditional,
  );
  if (hardMissing.length > 0) {
    notes.push(
      `${hardMissing.length} unconditional field(s) are absent — likely a myUSCIS rename. ` +
        "Re-capture this page and update the descriptor.",
    );
  }
  if (extra.length > 0) {
    notes.push(
      `${extra.length} field(s) on the page are not in the descriptor — new USCIS field(s), ` +
        "or fields we deliberately leave to the user.",
    );
  }

  return { slug: page.slug, title: page.title, present, missing, extra, notes };
}

/** One-line summary for the toolbar status. */
export function summarizeAudit(audit: PageAudit): string {
  return (
    `${audit.title}: ${audit.present.length} present, ` +
    `${audit.missing.length} missing, ${audit.extra.length} extra`
  );
}
