// Extension health telemetry — "questions we don't fill" beacons to Slack.
//
// The signal we care about: a question is RENDERED on the live form that our
// descriptor does not cover. That means the form (or the questionnaire behind
// it) grew a field and the extension is silently missing it — the break a
// developer can act on. (The opposite — a descriptor field the form no longer
// shows — is harmless and deliberately NOT reported.)
//
// At the end of a run we post ONE Slack message listing those unmapped
// questions with the real rendered label, the section + subsection, and the
// case id (so a developer can open the case). NO field VALUES are ever sent —
// the client's data (names, DOB, passport, SSN) must not land in Slack.
//
// The Slack POST goes through the service worker (download-proxy.ts), the only
// context allowed to reach hooks.slack.com. recordUnmappedField/auditUnmappedFields
// touch no chrome API, so the pure page-walk stays unit-testable; only
// flushUnmappedFields talks to chrome. Best-effort — a telemetry failure must
// NEVER affect the fill walk.

import { visibleLabel } from "./value-setter";

// Shown in the Slack message so one channel can serve both extensions.
const PRODUCT = "Family";

export interface UnmappedField {
  /** The form control's name (a Formik path). */
  name: string;
  /** Human-readable question text as rendered on the form. */
  label: string;
  /** input type / "select" / "textarea" / "radio". */
  type: string;
  /** Whether the form marks the question required. */
  required: boolean;
  /** Section/page title. */
  section: string;
  /** URL pathname the miss was seen on. */
  subsection: string;
}

// Repeater row indices collapse to one token so indexed rows (otherNames.0.*,
// travelHistory.2.country, …) match the descriptor's coverage — which resolves
// `{i}`/`{j}` to 0. Applied to BOTH the coverage set and the rendered name.
const REPEATER_TOKEN = "<i>";
export function normalizeName(name: string): string {
  return name
    .replace(/\{[ij]\}/g, REPEATER_TOKEN)
    .replace(/\.\d+(?=\.|$)/g, `.${REPEATER_TOKEN}`);
}

// Accumulates across the whole run, deduped by section+name, so a run produces
// ONE message rather than one per page/section.
const buffer = new Map<string, UnmappedField>();

export function recordUnmappedField(f: UnmappedField): void {
  const key = `${f.section}|${f.name}`;
  if (!buffer.has(key)) buffer.set(key, f);
}

export function pendingTelemetryCount(): number {
  return buffer.size;
}

/** Best real-label for a control: aria-label / bound <label> (visibleLabel),
 * then a wrapping <label>, else empty. */
function labelFor(el: Element): string {
  const v = visibleLabel(el);
  if (v) return v;
  const wrapping = el.closest("label");
  if (wrapping?.textContent) return wrapping.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
  return "";
}

/**
 * Record every rendered, visible, fillable field whose (normalized) name is not
 * in `coverage` — i.e. a question the form asks that the descriptor doesn't
 * drive. Buffered; flushed once per run by flushUnmappedFields.
 */
export function auditUnmappedFields(coverage: Set<string>, section: string): void {
  const subsection = location.pathname;
  const seen = new Set<string>();
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const name = el.getAttribute("name");
    if (!name || seen.has(name)) continue;
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el as HTMLInputElement).type : tag;
    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) continue;
    if ((el as HTMLElement).offsetParent === null) continue; // not visible
    seen.add(name);
    if (coverage.has(normalizeName(name))) continue;
    recordUnmappedField({
      name,
      label: labelFor(el),
      type: type === "tel" ? "phone" : type,
      required: el.getAttribute("aria-required") === "true" || el.hasAttribute("required"),
      section,
      subsection,
    });
  }
}

/** Post everything buffered so far as one Slack message, then clear. */
export async function flushUnmappedFields(formType: string, caseId: string): Promise<void> {
  if (buffer.size === 0) return;
  const fields = [...buffer.values()];
  buffer.clear();

  try {
    let version = "unknown";
    try {
      version = chrome.runtime?.getManifest?.().version ?? "unknown";
    } catch {
      /* not in an extension context */
    }
    // pathname only — never location.search (may carry case ids / tokens)
    const page = `${location.hostname}${location.pathname}`;
    const caseRef = caseId ? `\`${caseId}\`` : "`unknown`";
    const lines = fields
      .map((f) => {
        const req = f.required ? "  *(required)*" : "";
        const label = f.label || "(no label found)";
        return `• [${f.section}] ${label}${req}\n   \`${f.name}\` · ${f.subsection}`;
      })
      .join("\n");
    const text =
      `:mag: *Unmapped form questions — ${PRODUCT} / ${formType}*\n` +
      `Case: ${caseRef}  •  Extension v${version}\n` +
      `${fields.length} rendered question(s) the extension does not fill:\n${lines}\n` +
      `Page: ${page}`;

    await chrome.runtime.sendMessage({ type: "SLACK_POST", text });
  } catch {
    // Best-effort: never surface a telemetry failure to the fill walk.
  }
}
