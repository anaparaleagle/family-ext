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
import { FieldSpec, LocateSpec, SetResult } from "./types";

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

/** Collapse whitespace runs so derived label text compares against live DOM text
 * that carries newlines and indentation. */
function normaliseText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The visible label for an input: aria-label, then a bound <label for=…>. */
function visibleLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return normaliseText(aria);
  const id = el.getAttribute("id");
  if (id) {
    const bound = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (bound) return normaliseText(bound.textContent || "");
  }
  return "";
}

/** Same tag AND same input type, so a text field never resolves to a checkbox
 * sitting beside it. */
function sameType(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  return (a.getAttribute("type") || "text") === (b.getAttribute("type") || "text");
}

/**
 * Find the input for a spec, falling back to structure and then label when its
 * `name` is not in the DOM.
 *
 * Order is deliberate:
 *   1. `name` — exact, cheapest, and correct whenever the name is stable. A field
 *      with a real Formik path must never take a fallback path.
 *   2. `locate.nearName` — the next same-type input after a VERIFIED anchor,
 *      searched only inside the anchor's own field group, so a second address
 *      block cannot be filled from the first block's anchor.
 *   3. `locate.labelContains` — normalised substring match on the visible label.
 *
 * Returns null rather than guessing. A wrong element here would type a value into
 * someone else's field, which is far worse than a reported failure.
 */
export function locateElement(spec: FieldSpec): HTMLElement | null {
  const byName = findByName(spec.name, spec.optionValue);
  if (byName) return byName;
  const locate = spec.locate;
  if (!locate) return null;

  // A RADIO resolves as a GROUP, and only locateRadios knows how to find one
  // (nameContains, or the smallest container carrying the question text). The
  // generic strategies below find ONE element by ITS OWN label — for a radio
  // that is the option text ("Yes"), which every yes/no group on the page
  // shares, so falling through would anchor on the wrong question. This is what
  // lets waitForRevealed and the conditional probe SEE a question-anchored
  // radio (the pdf-intake I-765's colliding `controlled-radio-buttons-group`
  // pair): setRadio could already click it, but locateElement said "absent".
  if (spec.kind === "radio") {
    const group = locateRadios(locate);
    if (group.length === 0) return null;
    if (spec.optionValue !== undefined) {
      const match = group.find((r) => r.value === spec.optionValue);
      if (match) return match;
    }
    return group[0];
  }

  // An id identifies exactly one element, so it goes before the anchor walk and
  // the label match — both of which can land on a neighbour.
  if (locate.id) {
    const byId = document.getElementById(locate.id);
    if (byId) return byId;
  }

  if (locate.nearName) {
    const anchor = findByName(locate.nearName);
    if (anchor) {
      // Search the anchor's own field group. Without that containment a bare
      // wrapper would widen the search to the whole document and any later input
      // would match.
      const group =
        anchor.closest(".MuiFormControl-root, fieldset, .MuiFormGroup-root") ??
        anchor.parentElement;
      if (group) {
        const inputs = Array.from(group.querySelectorAll<HTMLElement>("input, textarea, select"));
        const at = inputs.indexOf(anchor as HTMLElement);
        if (at !== -1) {
          for (const candidate of inputs.slice(at + 1)) {
            if (sameType(anchor, candidate)) return candidate;
          }
        }
      }
    }
  }

  if (locate.labelContains) {
    const want = normaliseText(locate.labelContains).toLowerCase();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"))) {
      if (visibleLabel(el).toLowerCase().includes(want)) return el;
    }
  }

  return null;
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

  // Strategy 0: a masked box (the I-485 A-number's "A-") gets keystrokes, before
  // anything below clears the mask's own prefix out of it.
  if (maskPrefix(el, value) && (await typeKeystrokes(el, value))) return true;

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
  if (safeExec("insertText", value) && matchesValue(el, value)) {
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
  setNativeValue(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (matchesValue(el, value)) {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return true;
  }

  // Strategy 5: keystrokes, for a mask that only showed itself once something
  // was written into the box.
  if (await typeKeystrokes(el, value)) return true;

  dbg(`value-setter: all text strategies failed for "${el.getAttribute("name")}"`);
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  return false;
}

/**
 * The fixed prefix a masked box is already showing, or "".
 *
 * myUSCIS masks the I-485 A-number with a literal "A-" that lives IN the input.
 * The mask reads what the box holds on every input event and throws away
 * anything that does not start with its prefix, so select-all-and-type (which
 * deletes the "A-" first) leaves the field empty and the page refusing Next.
 *
 * Deliberately narrow: short, no digits, and not a head of the value we are
 * about to write — a box holding a real stale value must still be overwritten.
 */
function maskPrefix(el: HTMLInputElement | HTMLTextAreaElement, value: string): string {
  const current = el.value;
  if (!current || value.startsWith(current)) return "";
  const bare = current.replace(/[\u200B-\u200D\uFEFF]/g, "");
  return bare.length <= 3 && !/\d/.test(bare) ? current : "";
}

/**
 * Type `value` one character at a time, the way a person does: each keystroke
 * appends to whatever the box currently holds, so a mask reformats as it goes
 * and its own prefix is never deleted. The last resort for inputs that refuse a
 * value written in one go.
 */
async function typeKeystrokes(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<boolean> {
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  if (el.value && !maskPrefix(el, value)) {
    setNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }
  for (const char of value) {
    const before = el.value;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    setNativeValue(el, before + char);
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      // not every input type carries a selection
    }
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }),
    );
    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
    await sleep(30);
  }
  await sleep(120);
  if (!matchesValue(el, value)) return false;
  commitText(el);
  return true;
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

/** Shortest target we will match loosely. Anything shorter is a CODE ("1", "3",
 * "Y") that the exact pass already had its chance at, and a one-character
 * needle matches almost any label. */
const LOOSE_MATCH_MIN = 4;

/**
 * Does `needle` sit inside `haystack` and END on a word boundary?
 *
 * A bare `includes` is too loose in both directions. "Wage Level I" is a prefix
 * of "Wage Level IV", so a target of "wage level i" matched the IV option and
 * clicked it whenever it came first in the DOM — the H-1B extension hit exactly
 * this and fixed it the same way (SOF-568). The character after the match must
 * not be alphanumeric, so I does not match II/III/IV, L1 does not match L1A, and
 * P1 does not match P1B.
 */
function containsAtBoundary(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const after = haystack[idx + needle.length];
  return after === undefined || !/[a-z0-9]/.test(after);
}

/** The option in `radios` that answers `value`, or null.
 *
 * Two passes, in this order, because they are not equally trustworthy: an exact
 * value or label (plus the yes/no aliases) is proof, a substring is inference. */
function pickRadio(radios: HTMLInputElement[], value: string): HTMLInputElement | null {
  const wanted = value.toLowerCase();
  const aliases = RADIO_ALIASES[wanted] ?? [];
  for (const radio of radios) {
    const rv = (radio.value || "").toLowerCase();
    const label = radioLabel(radio).toLowerCase();
    if (rv === wanted || label === wanted || aliases.includes(rv) || aliases.includes(label)) {
      return radio;
    }
  }
  // Second pass, SUBSTRING. Some of the option strings in the I-129 map are LABEL
  // TEXT lifted from the H-1B extension, which matched options by substring — they
  // were never proven to equal the input's `value`, and the live label often
  // carries an "A. " prefix or wraps the declared text. Exact matching alone left
  // those five groups unfillable (I129_UNVERIFIED_OPTIONS in the descriptor).
  if (wanted.length < LOOSE_MATCH_MIN) return null;
  for (const radio of radios) {
    const rv = (radio.value || "").toLowerCase();
    const label = radioLabel(radio).toLowerCase();
    if (
      containsAtBoundary(label, wanted) || containsAtBoundary(wanted, label) ||
      containsAtBoundary(rv, wanted) || containsAtBoundary(wanted, rv)
    ) {
      return radio;
    }
  }
  return null;
}

/** The radio group a `locate` spec points at, for a group whose declared name is
 * not the one on the page. Empty when the spec finds nothing. */
function locateRadios(locate: LocateSpec): HTMLInputElement[] {
  if (locate.nameContains) {
    const byName = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name*="${cssEscape(locate.nameContains)}" i]`,
      ),
    );
    if (byName.length) return byName;
  }
  if (!locate.labelContains) return [];
  // SMALLEST container whose text carries the label and holds radios. Largest
  // would always be <body>, which on a page with two groups picks the wrong one.
  const want = normaliseText(locate.labelContains).toLowerCase();
  let best: { radios: HTMLInputElement[]; size: number } | null = null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (!radios.length) continue;
    if (!normaliseText(el.textContent ?? "").toLowerCase().includes(want)) continue;
    const size = (el.textContent ?? "").length;
    if (!best || size < best.size) best = { radios, size };
  }
  return best?.radios ?? [];
}

function setRadio(name: string, value: string, locate?: LocateSpec): boolean {
  let radios = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${cssEscape(name)}"]`,
    ),
  );
  // The declared name is not on the page. myUSCIS renames Formik paths between
  // form editions, so a group we can still identify structurally is not a miss.
  if (radios.length === 0 && locate) {
    radios = locateRadios(locate);
    if (radios.length) {
      dbg(`value-setter: "${name}" not on page; located a group of ${radios.length} by locate`);
    }
  }
  const chosen = pickRadio(radios, value);
  if (chosen) return clickRadio(chosen);
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

function clickRadio(radio: HTMLInputElement): boolean {
  radio.click();
  radio.dispatchEvent(new Event("change", { bubbles: true }));
  radio.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
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

/**
 * Set an input's value the way React notices.
 *
 * The prototype setter is what React's `_valueTracker` watches, and the tracker
 * is cleared first so an assignment it thinks it already has is not swallowed.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker) tracker.setValue("");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * Make `text` the autocomplete's live query.
 *
 * Was: select-all, `execCommand("delete")`, then one `insertText` per character
 * behind a 30ms sleep. Neither half survived the live form.
 *
 * A React-controlled input restores its value on every re-render, so the delete
 * never stuck — the box kept its committed value and each insertText appended one
 * character the next one overwrote. Sampled live on the N-400 contact page:
 * "New York" -> "New Yorkl" -> "New Yorki" -> "New Yorkn". MUI therefore filtered
 * against the OLD value and never offered the target, so a field that had to
 * CHANGE silently kept the wrong answer while the run reported 15/17 filled. A
 * wrong value nothing surfaces is worse than a blank one.
 *
 * The per-character sleep was the other half. Chrome clamps timers in a hidden tab
 * to roughly one per second, so a 13-character country took 13 seconds and one
 * page took 121 — and a paralegal switching tabs during a 40-page walk is the
 * normal thing to do, not an edge case.
 *
 * One native write plus one input event fixes both: it is a real change React
 * cannot restore over, and it costs no per-character timer.
 */
async function typeInto(el: HTMLInputElement, text: string): Promise<void> {
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  // CLEAR, as its own step and its own input event. This is the half that select-all
  // + execCommand("delete") never achieved on a controlled input.
  setNativeValue(el, "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  // Then TYPE. Real per-character edits are what make the widget re-filter from
  // scratch; one bulk assignment left it filtering from wherever it already was, and
  // that is how the height pickers rendered 0 options for "5" — a value that IS in
  // their list, and one character long, so every probe equals it and there is nothing
  // shorter to fall back to. No sleep between characters: it bought nothing, and a
  // hidden tab clamps each one to about a second.
  el.select();
  for (const char of text) safeExec("insertText", char);
  // execCommand is not guaranteed (and is inert in the test DOM), so fall back rather
  // than leaving the box empty — an empty query is worse than a bulk one.
  if (el.value !== text) setNativeValue(el, text);
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
 * Dump an option list next to the value that missed it, and say WHICH of the
 * three verdicts applies (timing miss / punctuation-only difference in our
 * value / genuinely absent). Shared by the autocomplete diagnostic and the MUI
 * Select diagnostic — the evidence a miss must leave behind is the same for
 * both, only how the list gets on screen differs.
 */
function reportOptionsVerdict(value: string, options: string[], label: string): void {
  if (options.length === 0) return;
  dbg(`  ${label} (${options.length}):`);
  for (const o of options.slice(0, MAX_LOGGED_OPTIONS)) dbg(`    ${JSON.stringify(o)}`);
  if (options.length > MAX_LOGGED_OPTIONS) {
    dbg(`    ...and ${options.length - MAX_LOGGED_OPTIONS} more`);
  }
  // The punctuation/spacing verdict — the whole point of the exercise.
  const key = labelKey(value);
  const twin = options.find((o) => labelKey(o) === key);
  if (twin === value) {
    // The label and the value are the same string, so nothing about the value
    // is wrong and there is no captured table to go and fix. The only thing
    // that differed between the read that missed and this one is TIME.
    dbg(`  VERDICT: the option is there and IDENTICAL to our value.`);
    dbg(`    live and ours: ${JSON.stringify(value)}`);
    dbg(`    So the list had not rendered when we read it - a timing miss, not a bad value.`);
  } else if (twin) {
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
}

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

  if (shown.length > 0) {
    dbg(`  So the list was NOT empty — the matcher rejected every option.`);
    reportOptionsVerdict(value, shown, "options on screen");
    return;
  }

  // Empty list. Re-type just the first word to recover the real labels.
  const firstWord = (value.match(/[A-Za-z0-9]+/) ?? [""])[0];
  if (!firstWord) return;
  dbg(`  The list was EMPTY -> what we typed over-filtered it.`);
  dbg(`  Re-typing just ${JSON.stringify(firstWord)} to read the real labels (selects nothing):`);
  await typeInto(el, firstWord);
  await sleep(1500);
  reportOptionsVerdict(value, renderedOptions(), `options for ${JSON.stringify(firstWord)}`);
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
 *
 * Returns the option element it clicked (truthy), or null on no match — the
 * MUI Select path needs the ELEMENT (its data-value is the fallback commit
 * check), and every boolean caller reads truthiness unchanged.
 */
async function selectRenderedOption(wanted: string): Promise<HTMLElement | null> {
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
  return null;
}

/**
 * Settle time after re-typing the SAME value when the first pass rendered nothing.
 *
 * Live on 2026-08-29 `height.inches` missed the value "10" with "options rendered
 * after typing that: 0", and the diagnostic — which does nothing but type the same
 * characters again and wait — then read two options, one of them exactly "10". So
 * the list was not absent, it was not there YET, and the same keystrokes a moment
 * later produced it. A short value cannot fall back on the recovery probes either:
 * for a two-character value every probe equals the value and is dropped, so that
 * one read was the entire attempt.
 */
const RETYPE_SETTLE_MS = 900;

/** The popup container itself, whether or not it holds any options yet. */
const LISTBOX_SELECTORS = [
  '[role="listbox"]',
  ".MuiAutocomplete-listbox",
  ".MuiAutocomplete-popper",
].join(", ");

/**
 * True when NO popup is mounted at all.
 *
 * This is what separates "the list is not there yet" from "the list is there and
 * our query filtered it to nothing". They look identical if you only count
 * options, and they need opposite fixes: type the SAME thing again, or type LESS.
 * Only the first is worth a second pass, so a genuine over-filter pays nothing.
 */
function noListboxMounted(): boolean {
  return document.querySelector(LISTBOX_SELECTORS) === null;
}

async function click(opt: HTMLElement): Promise<HTMLElement> {
  opt.click();
  await sleep(150);
  return opt;
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
  // What the client already had. Nothing is committed until an option is CLICKED,
  // so on every failure path below the box is still holding our query text and
  // that has to be put back — see the restore at the end.
  const committed = el.value;
  await typeInto(el, value);
  await sleep(1500);
  if (await selectRenderedOption(value)) return true;

  // NOT a recovery — the query was fine. An EMPTY list here means the widget had
  // not rendered it when we looked, so type the same thing again and look once
  // more. A list that DID render and simply lacks the value falls straight
  // through to the shorter probes below, so a genuine miss pays nothing.
  if (renderedOptions().length === 0 && noListboxMounted()) {
    await typeInto(el, value);
    await sleep(RETYPE_SETTLE_MS);
    if (await selectRenderedOption(value)) {
      dbg(`value-setter: matched ${JSON.stringify(value)} on a second pass — the list was late`);
      return true;
    }
  }

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
  // Diagnosed FIRST (it reads the options our query rendered), then undone. Typing
  // a query is not an answer, so a miss must leave the field exactly as the client
  // left it rather than holding a half-typed probe — clearing the box to reach the
  // full option list must never become a way to lose an answer.
  if (el.value !== committed) {
    setNativeValue(el, committed);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── MUI Select (combobox display + hidden native input) ──────────────────────
//
// LIVE FAILURE, pdf-intake I-765 /select-eligibility (2026-09-12): the
// eligibility control is NOT an Autocomplete. The named element is MUI Select's
// hidden native input (class MuiSelect-nativeInput, aria-hidden, carries the
// committed CODE — "C9"/"A12"), and the visible element is a sibling
// div[role="combobox"] showing the current option's label. Typing into the
// hidden input does nothing: the popup opens on MOUSEDOWN (or Enter/Space/
// ArrowDown on the combobox), never filters, and portals its [role="option"]
// items to document.body. The type-to-filter path therefore rendered 0 options
// and its "re-type less" recovery recovered nothing.
//
// Detection is STRUCTURAL, not a descriptor flag: pdf-intake presented this
// same name as a plain text input in the original capture, so which widget is
// on the page is the DOM's fact, not the descriptor's. An Autocomplete can
// never be mistaken for a Select — its typeable input carries role="combobox"
// ITSELF, while a Select's named input is hidden beside a separate combobox.

/** How long the popup gets to render its options after being opened. */
const MUISELECT_OPEN_TIMEOUT_MS = 3000;
/** How long a clicked option gets to commit into the hidden input. React
 * re-renders the display text asynchronously, so the hidden input's value is
 * polled — it is the ground truth, and it can land late. */
const MUISELECT_COMMIT_TIMEOUT_MS = 4000;
const MUISELECT_POLL_MS = 100;
/** How many times to pick an option before giving up. A click that lands while
 * the popup is still settling leaves the hidden input empty with no error —
 * seen once on the I-485's Family-based category in six live runs. */
const MUISELECT_ATTEMPTS = 2;
/** Let the popup finish closing before picking again. */
const MUISELECT_RETRY_WAIT_MS = 400;

/**
 * The combobox DISPLAY element when `el` is a MUI Select's hidden native
 * input, else null (drive it as the autocomplete/text it is).
 */
function muiSelectComboboxFor(el: HTMLElement): HTMLElement | null {
  // An Autocomplete's typeable input IS the combobox — never select-style.
  if (el.getAttribute("role") === "combobox") return null;
  const input = el as HTMLInputElement;
  const hiddenish =
    el.classList.contains("MuiSelect-nativeInput") ||
    el.getAttribute("aria-hidden") === "true" ||
    input.readOnly === true ||
    input.type === "hidden";
  if (!hiddenish) return null;
  const scope = el.closest(".MuiFormControl-root, .MuiInputBase-root") ?? el.parentElement;
  const combo = scope?.querySelector<HTMLElement>('[role="combobox"]');
  return combo && combo !== el ? combo : null;
}

/**
 * Open the Select's popup and wait for its options to render. True once at
 * least one [role="option"] is on the document (they portal to body).
 *
 * mousedown first — that is the event MUI Select actually opens on (click alone
 * does nothing). If nothing renders in a beat, the keyboard route (Enter /
 * ArrowDown / Space on the combobox) is tried too before giving up.
 */
async function openMuiSelectPopup(combo: HTMLElement): Promise<boolean> {
  const anyOption = (): boolean => document.querySelector('[role="option"]') !== null;
  if (anyOption()) return true; // already open

  combo.focus();
  combo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  combo.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  combo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

  let keyed = false;
  for (let waited = 0; waited < MUISELECT_OPEN_TIMEOUT_MS; waited += MUISELECT_POLL_MS) {
    if (anyOption()) return true;
    if (!keyed && waited >= 1000) {
      // The mouse route did nothing — try the keys MUI Select also opens on.
      for (const key of ["Enter", "ArrowDown", " "]) {
        combo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      }
      keyed = true;
    }
    await sleep(MUISELECT_POLL_MS);
  }
  return anyOption();
}

/** Best-effort close, so a failed attempt does not leave a modal popup (and its
 * backdrop) over the rest of the page. */
function closeMuiSelectPopup(combo: HTMLElement): void {
  combo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const backdrop = document.querySelector<HTMLElement>(".MuiBackdrop-root");
  backdrop?.click();
}

/**
 * Explain a Select miss in the log. The autocomplete diagnostic's "re-type less"
 * recovery is meaningless here — typing never opens a Select, which is exactly
 * why the live diagnostic printed an empty list twice. For a Select the only way
 * to read the real labels is to OPEN the popup, so that is what this does, then
 * hands the list to the shared verdict reporter.
 */
async function diagnoseMuiSelectMiss(
  el: HTMLInputElement,
  combo: HTMLElement,
  value: string,
): Promise<void> {
  const name = el.getAttribute("name") ?? "(unnamed)";
  dbg(`value-setter: DIAGNOSTIC for "${name}" (MUI Select)`);
  dbg(`  we wanted to click: ${JSON.stringify(value)} (${value.length} chars)`);
  let shown = renderedOptions();
  if (shown.length === 0) {
    dbg(`  no options on screen — opening the popup to read the labels (typing cannot open a Select):`);
    await openMuiSelectPopup(combo);
    shown = renderedOptions();
  }
  if (shown.length === 0) {
    dbg(`  the popup rendered NOTHING even after mouse + keyboard opens — the control may be disabled`);
    return;
  }
  reportOptionsVerdict(value, shown, "options in the popup");
}

/**
 * Drive a MUI Select: open the popup, click the option whose label matches
 * `value`, then verify the HIDDEN INPUT committed. `commitValue` is the payload
 * code the descriptor promised the input commits ("C9"); without one, the
 * clicked option's data-value (MUI mirrors the MenuItem value there) stands in,
 * and with neither the check degrades to "the value changed at all".
 */
async function setMuiSelect(
  el: HTMLInputElement,
  combo: HTMLElement,
  value: string,
  commitValue?: string,
): Promise<boolean> {
  const name = el.getAttribute("name") ?? "(unnamed)";
  dbg(
    `value-setter: "${name}" is a MUI Select (hidden native input + combobox display) — ` +
      `opening the popup instead of typing`,
  );
  for (let attempt = 1; attempt <= MUISELECT_ATTEMPTS; attempt += 1) {
    const outcome = await pickMuiSelectOption(el, combo, value, name, commitValue);
    if (outcome !== "no-commit") return outcome === "ok";
    if (attempt < MUISELECT_ATTEMPTS) {
      dbg(`value-setter: picking "${value}" again on "${name}" — the first click did not stick`);
      closeMuiSelectPopup(combo);
      await sleep(MUISELECT_RETRY_WAIT_MS);
    }
  }
  return false;
}

/** One open-pick-verify pass. "no-commit" is the retryable outcome: the option
 * was clicked but the hidden input never took the value. */
async function pickMuiSelectOption(
  el: HTMLInputElement,
  combo: HTMLElement,
  value: string,
  name: string,
  commitValue?: string,
): Promise<"ok" | "no-commit" | "fail"> {
  const before = el.value;

  if (!(await openMuiSelectPopup(combo))) {
    dbg(`value-setter: the "${name}" popup never rendered any [role="option"] items`);
    await diagnoseMuiSelectMiss(el, combo, value);
    closeMuiSelectPopup(combo);
    return "fail";
  }

  const picked = await selectRenderedOption(value);
  if (!picked) {
    dbg(`value-setter: no select option matched "${value}" for "${name}"`);
    await diagnoseMuiSelectMiss(el, combo, value);
    closeMuiSelectPopup(combo);
    return "fail";
  }

  const want = commitValue ?? picked.getAttribute("data-value") ?? undefined;
  const deadline = Date.now() + MUISELECT_COMMIT_TIMEOUT_MS;
  for (;;) {
    const committed = want !== undefined ? el.value === want : el.value !== before;
    if (committed) {
      dbg(`value-setter: "${name}" committed ${JSON.stringify(el.value)} for ${JSON.stringify(value)}`);
      return "ok";
    }
    if (Date.now() >= deadline) break;
    await sleep(MUISELECT_POLL_MS);
  }
  if (want === undefined && el.value === before && before !== "") {
    // No expected code to check against and no change observed — the control may
    // simply already have held the right answer. Say so rather than failing a
    // click that landed on the right label.
    dbg(
      `value-setter: clicked ${JSON.stringify(value)} on "${name}" but no expected code is ` +
        `declared and the hidden input still holds ${JSON.stringify(before)} — treating as set`,
    );
    return "ok";
  }
  dbg(
    `value-setter: clicked ${JSON.stringify(value)} but the hidden "${name}" input holds ` +
      `${JSON.stringify(el.value)}` +
      (want !== undefined ? ` (expected ${JSON.stringify(want)})` : "") +
      ` — the selection did NOT commit`,
  );
  return "no-commit";
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
      const ok = setRadio(name, spec.optionValue ?? value, spec.locate);
      return result(name, ok, ok ? "set radio" : "radio option not found");
    }

    // locateElement is findByName plus the declared structural/label fallbacks.
    // For a field with a stable name it IS findByName, so nothing changes there.
    // Radios are handled above rather than here: they resolve by (name, option)
    // across a whole GROUP, so they need locateRadios, which returns the group,
    // not locateElement, which returns one element.
    const el = locateElement(spec);
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
        // Same descriptor kind, two live widgets. When the named input turns
        // out to be MUI Select's hidden native input (the pdf-intake I-765
        // eligibility control), typing filters nothing — the popup must be
        // clicked open and the option clicked by label.
        const combo = muiSelectComboboxFor(el);
        const ok = combo
          ? await setMuiSelect(el, combo, value, spec.commitValue)
          : await setSearch(el, value);
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
