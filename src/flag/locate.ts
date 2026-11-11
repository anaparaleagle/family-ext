import { locateElement } from "../engine/value-setter";
import { FlagField, flagFieldSpec } from "./types";

const LABEL_MAX_CHARS = 300;
const LABEL_DEPTH = 4;

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when `text` opens with the box number itself, so "F.d.1" does not claim "F.d.1.a". */
export function startsWithBox(text: string, prefix: string): boolean {
  const want = norm(prefix).replace(/\.$/, "");
  const got = norm(text);
  if (!got.startsWith(want)) return false;
  return /^\.?(\s|[^a-z0-9.]|$)/i.test(got.slice(want.length));
}

/** The one visible input in the field whose label starts with `prefix`, or null. */
export function findByBoxPrefix(prefix: string): HTMLElement | null {
  const found = new Set<HTMLElement>();
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>("label, legend, p, span, div, h3, h4, h5"),
  )) {
    if (el.childElementCount > 8) continue;
    const text = el.textContent ?? "";
    if (text.length > LABEL_MAX_CHARS || !startsWithBox(text, prefix)) continue;
    let scope: HTMLElement | null = el;
    for (let depth = 0; scope && depth < LABEL_DEPTH; depth++, scope = scope.parentElement) {
      const inputs = scope.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select',
      );
      if (inputs.length === 0) continue;
      if (inputs.length === 1) found.add(inputs[0]);
      break;
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/** The first textarea after the control named `name`, before the next checkbox or radio. */
function textareaAfter(name: string): HTMLElement | null {
  const anchor = document.querySelector(`[name="${CSS.escape(name)}"]`);
  if (!anchor) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"));
  for (const el of all.slice(all.indexOf(anchor as HTMLElement) + 1)) {
    if (el.tagName === "TEXTAREA") return el;
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return null;
  }
  return null;
}

/** Where a descriptor field lives on the page right now, whichever way it has to be found. */
export function locateFlagField(field: FlagField): HTMLElement | null {
  if (field.boxPrefix) return findByBoxPrefix(field.boxPrefix);
  if (field.byLabel) return locateElement(flagFieldSpec(field));
  if (field.byId) return document.getElementById(field.name);
  const byName = document.querySelector<HTMLElement>(`[name="${CSS.escape(field.name)}"]`);
  if (byName) return byName;
  return field.afterName ? textareaAfter(field.afterName) : null;
}

/** The smallest ancestor of `el` that also holds the label starting with `prefix`. */
export function fieldContainer(el: HTMLElement, prefix?: string): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    if (!prefix) {
      if (depth >= 2) return node;
      continue;
    }
    const labels = node.querySelectorAll<HTMLElement>("label, legend, p, span, div");
    for (const l of Array.from(labels)) {
      if (l.childElementCount > 8) continue;
      const text = l.textContent ?? "";
      if (text.length <= LABEL_MAX_CHARS && startsWithBox(text, prefix)) return node;
    }
  }
  return el.parentElement ?? el;
}
