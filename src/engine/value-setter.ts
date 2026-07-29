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
  // Name what WAS on the page. A radio miss is either a value we do not send in
  // the page's vocabulary (fix the backend map) or a group that is not really
  // there (fix the reveal) — and "0 options" vs "3 options that all differ"
  // tells those apart at a glance.
  if (radios.length === 0) {
    dbg(`  no inputs named "${name}" on this page at all — not a value problem`);
  } else {
    for (const radio of radios) {
      dbg(`  option value=${JSON.stringify(radio.value)} label=${JSON.stringify(radioLabel(radio))}`);
    }
  }
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

/** Type `text` into a focused autocomplete, one character at a time (MUI filters
 * per keystroke, so a bulk value assignment renders no options at all). */
async function typeInto(el: HTMLInputElement, text: string): Promise<void> {
  el.focus();
  el.select();
  safeExec("delete");
  for (const char of text) {
    safeExec("insertText", char);
    await sleep(30);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Every option currently rendered by the open listbox, de-duplicated. */
function renderedOptions(): string[] {
  const seen = new Set<string>();
  for (const sel of OPTION_SELECTORS) {
    for (const opt of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const text = (opt.textContent ?? "").trim();
      if (text) seen.add(text);
    }
  }
  return [...seen];
}

/** Comparison key that ignores every difference of punctuation, spacing and
 * case — so "Spouse Or Child Of F 1." and "Spouse or Child of F-1." collapse to
 * the same thing. Used ONLY for diagnosis, never to select an option. */
export function labelKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** How many option labels to print before truncating. */
const MAX_LOGGED_OPTIONS = 25;

/**
 * Explain an autocomplete miss in the log, in enough detail to fix it without a
 * second live run. READ-ONLY: it never selects an option, and it leaves the
 * input holding exactly the text it held on failure.
 *
 * The two causes need OPPOSITE fixes, so the log has to tell them apart:
 *
 *   - THE LIST WAS EMPTY -> what we typed over-filtered it. myUSCIS filters
 *     per keystroke, so one wrong character leaves nothing to click. The fix is
 *     ours: type less, then match. To recover the real labels anyway, this
 *     re-types just the FIRST WORD and dumps what renders.
 *
 *   - THE LIST HAD OPTIONS but none matched -> the label differs from the value
 *     we were given. `labelKey` then says whether it differs only by
 *     punctuation/spacing (a data bug in our captured table, fix the source) or
 *     genuinely is not there (wrong value entirely).
 */
async function diagnoseAutocompleteMiss(el: HTMLInputElement, value: string): Promise<void> {
  const name = el.getAttribute("name") ?? "(unnamed)";
  const shown = renderedOptions();
  dbg(`value-setter: DIAGNOSTIC for "${name}"`);
  dbg(`  we typed: ${JSON.stringify(value)} (${value.length} chars)`);
  dbg(`  options rendered after typing that: ${shown.length}`);

  const report = (options: string[], label: string): void => {
    if (options.length === 0) return;
    dbg(`  ${label} (${options.length}):`);
    for (const o of options.slice(0, MAX_LOGGED_OPTIONS)) dbg(`    ${JSON.stringify(o)}`);
    if (options.length > MAX_LOGGED_OPTIONS) {
      dbg(`    ...and ${options.length - MAX_LOGGED_OPTIONS} more`);
    }
    // The punctuation/spacing verdict — the whole point of the exercise.
    const key = labelKey(value);
    const twin = options.find((o) => labelKey(o) === key);
    if (twin) {
      dbg(`  VERDICT: the option IS there but the text differs.`);
      dbg(`    live:  ${JSON.stringify(twin)}`);
      dbg(`    ours:  ${JSON.stringify(value)}`);
      dbg(`    Same letters+digits, different punctuation/spacing -> OUR VALUE IS WRONG.`);
    } else {
      const near = options.filter((o) => {
        const k = labelKey(o);
        return k.includes(key.slice(0, 12)) || key.includes(k.slice(0, 12));
      });
      if (near.length) {
        dbg(`  VERDICT: no exact twin. Closest live label(s):`);
        for (const o of near.slice(0, 5)) dbg(`    ${JSON.stringify(o)}`);
      } else {
        dbg(`  VERDICT: nothing resembling this value is in the list at all.`);
      }
    }
  };

  if (shown.length > 0) {
    dbg(`  So the list was NOT empty — the matcher rejected every option.`);
    report(shown, "options on screen");
    return;
  }

  // Empty list. Re-type just the first word to recover the real labels.
  const firstWord = (value.match(/[A-Za-z0-9]+/) ?? [""])[0];
  if (!firstWord) return;
  dbg(`  The list was EMPTY -> what we typed over-filtered it.`);
  dbg(`  Re-typing just ${JSON.stringify(firstWord)} to read the real labels (selects nothing):`);
  await typeInto(el, firstWord);
  await sleep(1500);
  report(renderedOptions(), `options for ${JSON.stringify(firstWord)}`);
  // Restore the input to exactly what it held on failure, so this diagnostic
  // leaves no trace in the form state.
  await typeInto(el, value);
  await sleep(300);
  dbg(`  restored the input to ${JSON.stringify(value)} — diagnostic changed nothing`);
}

/** Strip a leading option CODE, e.g. "F1 - Student, ..." -> "Student, ...". The
 * I-539 status pickers label every option `CODE - Description`; our stored value is
 * the Description alone. */
function withoutCodePrefix(label: string): string {
  return label.replace(/^[A-Za-z0-9]{1,5}\s*-\s*/, "");
}

/**
 * Try to select `wanted` from whatever the listbox is currently showing.
 * Ordered widest-confidence first; every pass compares against the FULL wanted
 * value even when we typed only a fragment to get the list to render.
 */
async function selectRenderedOption(wanted: string): Promise<boolean> {
  const want = wanted.trim().toLowerCase();
  const wantKey = labelKey(wanted);
  for (const sel of OPTION_SELECTORS) {
    const options = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (options.length === 0) continue;
    const text = (o: HTMLElement): string => (o.textContent ?? "").trim();

    // 1. Exact label.
    for (const o of options) if (text(o).toLowerCase() === want) return click(o);

    // 2. Same letters and digits, different case/punctuation. This is the live
    //    "INDIA" vs "India" case (2026-07-29): myUSCIS's filter is CASE-SENSITIVE,
    //    so an all-caps fact never renders its own option.
    for (const o of options) if (labelKey(text(o)) === wantKey) return click(o);

    // 3. The label is `CODE - <wanted>`. The live status pickers are all shaped
    //    this way and we store only the Description, so this is the normal path
    //    for them — compared on labelKey so a whitespace difference in the
    //    captured description cannot break it.
    for (const o of options) {
      if (labelKey(withoutCodePrefix(text(o))) === wantKey) return click(o);
    }

    // 4. Prefix with a word boundary (stops "India" -> "Indian Ocean").
    for (const o of options) {
      const txt = text(o).toLowerCase();
      if (!txt.startsWith(want)) continue;
      const next = txt[want.length];
      if (next === undefined || !/[a-z0-9]/.test(next)) return click(o);
    }

    // 5. Whole-word match. The value must be a COMPLETE token in the label, never
    //    a mid-word substring — this is what stops "USA" matching "Jer(usa)lem"
    //    (confirmed live on the I-130 country autocomplete, 2026-06-26). Do not
    //    loosen it.
    const wordRe = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(want)}(?:[^a-z0-9]|$)`, "i");
    for (const o of options) if (wordRe.test(text(o))) return click(o);
  }
  return false;
}

async function click(opt: HTMLElement): Promise<boolean> {
  opt.click();
  await sleep(150);
  return true;
}

/**
 * Progressively shorter things to TYPE when the full value renders no options.
 *
 * myUSCIS filters on the whole label from its START, case-sensitively. So a value
 * that is only PART of the label — the Description of a `CODE - Description`
 * option — filters the list to nothing, and an all-caps value filters its own
 * option away. Typing less gets the list on screen; matching (above) then works on
 * the full value. Live proof 2026-07-29: "Student, Academic Or Language Program."
 * rendered 0 options while the real label was
 * "F1 - Student, Academic Or Language Program.".
 */
function typingProbes(value: string): string[] {
  const firstWord = (value.match(/[A-Za-z0-9]+/) ?? [""])[0];
  const probes = [value.slice(0, 12), firstWord, value.slice(0, 3)]
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== value);
  return [...new Set(probes)];
}

async function setSearch(el: HTMLInputElement, value: string): Promise<boolean> {
  await typeInto(el, value);
  await sleep(1500);
  if (await selectRenderedOption(value)) return true;

  // RECOVERY, not a retry: the previous attempt failed because of what we TYPED,
  // not because the option is absent. Type less and match again.
  for (const probe of typingProbes(value)) {
    await typeInto(el, probe);
    await sleep(1200);
    if (await selectRenderedOption(value)) {
      dbg(`value-setter: matched "${value}" after typing just ${JSON.stringify(probe)}`);
      return true;
    }
  }

  dbg(`value-setter: no autocomplete option matched "${value}" for "${el.getAttribute("name")}"`);
  await diagnoseAutocompleteMiss(el, value);
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
