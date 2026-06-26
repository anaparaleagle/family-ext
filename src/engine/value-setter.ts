// ===========================================================================
// HARVESTED + GENERICIZED from paraleagle-ext src/content/i129-filler.ts
// (origin/main value-setter waterfall). The I-129 field-map specifics
// (FIELD_MAP, section logic, fuzzy label matching, P3 bespoke rows) were left
// behind. What remains is the proven, data-agnostic mechanism for committing a
// value to one React/Formik-controlled myUSCIS input, selected purely by its
// `[name]` attribute (the backend keys ARE the Formik names).
//
// The waterfall, unchanged in spirit from the I-129 filler:
//   text  : execCommand insertText (char-by-char) -> bulk -> Formik bridge
//           -> native value setter w/ _valueTracker reset
//   phone : strip non-digits, drop leading "1", native setter
//   search: MUI Autocomplete — type char-by-char, wait, click first match
//   radio : click the input[name][value] (yes/no aliasing), fire change/input
//   check : click to desired state
// ===========================================================================

import { dbg } from "./logger";
import { FieldSpec, SetResult } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** execCommand is the preferred path for React-controlled inputs, but it is not
 * universally implemented (older browsers, and the jsdom/happy-dom test env
 * throw "not a function"). Guard it so a missing/throwing execCommand falls
 * through to the native-setter strategy instead of aborting the whole fill. */
function safeExec(command: string, value?: string): boolean {
  try {
    if (typeof document.execCommand !== "function") return false;
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/** Bridge to the MAIN-world Formik setter (see engine/formik-bridge.ts). The
 * element must have an id; we dispatch and read back the ack attribute. */
function setViaFormik(el: HTMLElement, value: string): boolean {
  const fieldName = el.getAttribute("name");
  if (!fieldName || !el.id) return false;

  document.dispatchEvent(
    new CustomEvent("mk-autofill-set-formik", {
      detail: { elementId: el.id, fieldName, value },
    }),
  );
  const result = el.getAttribute("data-formik-set");
  el.removeAttribute("data-formik-set");
  return result === "ok";
}

/** Find the input/select/textarea for a Formik name. Radios share a name, so
 * callers that need a specific option pass `optionValue`. */
export function findByName(name: string, optionValue?: string): HTMLElement | null {
  const escaped = cssEscape(name);
  if (optionValue !== undefined) {
    const withVal = document.querySelector<HTMLElement>(
      `[name="${escaped}"][value="${cssEscape(optionValue)}"]`,
    );
    if (withVal) return withVal;
  }
  return document.querySelector<HTMLElement>(`[name="${escaped}"]`);
}

/** Minimal CSS attribute-value escaper (names contain dots, which are legal in
 * an attribute *value* but we still guard quotes/backslashes). */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

// ── Text / date / textarea ────────────────────────────────────────────────

async function setText(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

  // Strategy 1: char-by-char execCommand (best for React-controlled inputs).
  el.select();
  safeExec("delete");
  for (const char of value) safeExec("insertText", char);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(120);
  if (matchesValue(el, value)) {
    commitText(el);
    setViaFormik(el, value);
    return true;
  }

  // Strategy 2: blur/refocus then bulk execCommand.
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await sleep(0);
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  el.select();
  if (safeExec("insertText", value) && el.value === value) {
    commitText(el);
    setViaFormik(el, value);
    return true;
  }

  // Strategy 3: Formik bridge (MAIN world).
  if (setViaFormik(el, value)) {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return true;
  }

  // Strategy 4: native value setter + change (reset React's _valueTracker).
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  if (nativeSetter) {
    const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
    if (tracker) tracker.setValue("");
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (el.value === value) {
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return true;
    }
  }

  dbg(`value-setter: all text strategies failed for "${el.getAttribute("name")}"`);
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  return false;
}

/** True when the input shows the value, OR shows the same digits (masked
 * inputs reformat — ZIP/SSN/phone — so digit-equality counts as success). */
function matchesValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  if (el.value === value) return true;
  const got = el.value.replace(/\D/g, "");
  const want = value.replace(/\D/g, "");
  return want.length > 0 && got === want;
}

function commitText(el: HTMLInputElement | HTMLTextAreaElement): void {
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

// ── Phone ─────────────────────────────────────────────────────────────────

function setPhone(el: HTMLInputElement, value: string): boolean {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);

  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (nativeSetter) nativeSetter.call(el, digits);
  else el.value = digits;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  setViaFormik(el, digits);
  return true;
}

// ── Radio / checkbox ──────────────────────────────────────────────────────

/** Yes/No <-> true/false aliases, so a backend "true" matches a radio whose
 * on-page value is "yes" (and vice versa). The family backend emits coded
 * option values ("1", "4", "true") that usually match the input value exactly;
 * this is the safety net. */
const RADIO_ALIASES: Record<string, string[]> = {
  true: ["yes", "y", "1"],
  false: ["no", "n", "0"],
  yes: ["true", "y", "1"],
  no: ["false", "n", "0"],
};

function setRadio(name: string, value: string): boolean {
  const radios = document.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${cssEscape(name)}"]`,
  );
  const wanted = value.toLowerCase();
  const aliases = RADIO_ALIASES[wanted] ?? [];
  for (const radio of radios) {
    const rv = (radio.value || "").toLowerCase();
    const label = radioLabel(radio).toLowerCase();
    if (rv === wanted || label === wanted || aliases.includes(rv) || aliases.includes(label)) {
      radio.click();
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      radio.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }
  dbg(`value-setter: no radio option matched "${value}" for "${name}" (${radios.length} options)`);
  return false;
}

function radioLabel(radio: HTMLInputElement): string {
  if (radio.id) {
    const lbl = document.querySelector(`label[for="${cssEscape(radio.id)}"]`);
    if (lbl) return lbl.textContent?.trim() ?? "";
  }
  const parent = radio.closest("label");
  if (parent) return parent.textContent?.trim() ?? "";
  return radio.value;
}

const TRUTHY = new Set(["on", "/on", "yes", "true", "1", "checked", "y"]);

function setCheckbox(el: HTMLInputElement, value: string): boolean {
  const shouldCheck = TRUTHY.has(value.toLowerCase().trim());
  if (el.checked !== shouldCheck) {
    el.click();
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

// ── Select (native dropdown) ──────────────────────────────────────────────

function setSelect(el: HTMLSelectElement, value: string): boolean {
  const want = value.toLowerCase().trim();
  // Exact value or text first, then substring.
  for (const opt of Array.from(el.options)) {
    if (opt.disabled) continue;
    const txt = (opt.textContent ?? "").trim();
    if (opt.value === value || txt === value ||
        opt.value.toLowerCase() === want || txt.toLowerCase() === want) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  for (const opt of Array.from(el.options)) {
    if (opt.disabled) continue;
    const txt = (opt.textContent ?? "").trim().toLowerCase();
    if (txt && (txt.includes(want) || want.includes(txt))) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  dbg(`value-setter: option "${value}" not in select "${el.getAttribute("name")}"`);
  return false;
}

// ── Search (MUI Autocomplete: country / state) ────────────────────────────

const OPTION_SELECTORS = [
  '[role="option"]',
  ".MuiAutocomplete-option",
  '[class*="option"]',
];

async function setSearch(el: HTMLInputElement, value: string): Promise<boolean> {
  el.focus();
  el.select();
  safeExec("delete");
  for (const char of value) {
    safeExec("insertText", char);
    await sleep(30);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(1500);

  const want = value.toLowerCase();
  for (const sel of OPTION_SELECTORS) {
    const options = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (options.length === 0) continue;
    // Pass 1: exact text.
    for (const opt of options) {
      if ((opt.textContent ?? "").trim().toLowerCase() === want) {
        opt.click();
        await sleep(150);
        return true;
      }
    }
    // Pass 2: prefix with a word boundary (stops "India" -> "Indian Ocean").
    for (const opt of options) {
      const txt = (opt.textContent ?? "").trim().toLowerCase();
      if (!txt.startsWith(want)) continue;
      const next = txt[want.length];
      if (next === undefined || !/[a-z0-9]/.test(next)) {
        opt.click();
        await sleep(150);
        return true;
      }
    }
    // Pass 3: whole-word match — the value must appear as a complete token in
    // the option label, NOT as a mid-word substring. This stops a short value
    // like "USA" from matching "Jer(usa)lem", which the old plain `.includes`
    // did (confirmed live on the I-130 country autocomplete, 2026-06-26).
    const wordRe = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(want)}(?:[^a-z0-9]|$)`, "i");
    for (const opt of options) {
      if (wordRe.test((opt.textContent ?? "").trim())) {
        opt.click();
        await sleep(150);
        return true;
      }
    }
  }
  dbg(`value-setter: no autocomplete option matched "${value}" for "${el.getAttribute("name")}"`);
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Set one value onto the page, selecting the element by its Formik `[name]`.
 * Returns a structured result; never throws. An empty string is a no-op
 * success for everything except checkboxes (where "" means "leave unchecked").
 */
export async function setValue(spec: FieldSpec, value: string): Promise<SetResult> {
  const { name, kind } = spec;
  try {
    if (kind === "radio") {
      const ok = setRadio(name, spec.optionValue ?? value);
      return result(name, ok, ok ? "set radio" : "radio option not found");
    }

    const el = findByName(name, spec.optionValue);
    if (!el) return result(name, false, "element not on page");

    switch (kind) {
      case "checkbox": {
        if (!(el instanceof HTMLInputElement)) return result(name, false, "not a checkbox");
        return result(name, setCheckbox(el, value), "set checkbox");
      }
      case "select": {
        if (!(el instanceof HTMLSelectElement)) return result(name, false, "not a select");
        const ok = setSelect(el, value);
        return result(name, ok, ok ? "set select" : "option not found");
      }
      case "phone": {
        if (!(el instanceof HTMLInputElement)) return result(name, false, "not an input");
        return result(name, setPhone(el, value), "set phone");
      }
      case "search": {
        if (!(el instanceof HTMLInputElement)) return result(name, false, "not an input");
        const ok = await setSearch(el, value);
        return result(name, ok, ok ? "set search" : "no match");
      }
      case "text":
      case "textarea":
      case "date": {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          return result(name, false, "not a text input");
        }
        const ok = await setText(el, value);
        return result(name, ok, ok ? "set text" : "could not set value");
      }
      default:
        return result(name, false, `unknown kind ${kind}`);
    }
  } catch (err) {
    return result(name, false, `error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function result(name: string, success: boolean, message: string): SetResult {
  return { name, success, message };
}
