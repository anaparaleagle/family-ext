import { dbg } from "../engine/logger";
import { LOCKED_MESSAGE, lockedByPage, setValue } from "../engine/value-setter";
import { SetResult } from "../engine/types";
import { fieldContainer, locateFlagField } from "./locate";
import { FlagField, flagFieldSpec } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SUGGEST_TIMEOUT_MS = 6000;
const POLL_MS = 150;
const RADIO_ATTEMPTS = 3;

function ok(name: string, message: string): SetResult {
  return { name, success: true, message };
}
function fail(name: string, message: string): SetResult {
  return { name, success: false, message };
}

function exec(command: string, value?: string): boolean {
  try {
    return typeof document.execCommand === "function" && document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

function nativeSet(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker) tracker.setValue("");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function focus(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function blur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  el.blur();
}

function clear(el: HTMLInputElement | HTMLTextAreaElement): void {
  if (!el.value) return;
  el.select();
  if (exec("delete") && !el.value) return;
  nativeSet(el, "");
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
}

/** Append one character the way a keyboard does, so React's onChange sees user input. */
function typeChar(el: HTMLInputElement | HTMLTextAreaElement, char: string): void {
  const before = el.value;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
  if (!exec("insertText", char) || el.value === before) {
    el.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: char, inputType: "insertText" }),
    );
    nativeSet(el, before + char);
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* not every input type has a selection */
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
  }
  el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
}

async function typeText(el: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  focus(el);
  clear(el);
  for (const char of text) typeChar(el, char);
  await sleep(50);
}

const KEY_CODES: Record<string, number> = { ArrowDown: 40, Enter: 13, Escape: 27 };

function press(el: HTMLElement, key: string): void {
  for (const type of ["keydown", "keyup"]) {
    const evt = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
    Object.defineProperty(evt, "keyCode", { get: () => KEY_CODES[key] ?? 0 });
    Object.defineProperty(evt, "which", { get: () => KEY_CODES[key] ?? 0 });
    el.dispatchEvent(evt);
  }
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** FLAG's "required" message inside the field, if it is showing one. */
function requiredError(el: HTMLElement): string {
  const box = el.closest("div")?.parentElement ?? el.parentElement;
  if (!box) return "";
  for (const msg of Array.from(
    box.querySelectorAll<HTMLElement>('[role="alert"], [class*="error"], [class*="invalid"], .usa-error-message'),
  )) {
    const text = (msg.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length < 160) return text;
  }
  return "";
}

// ── phone ───────────────────────────────────────────────────────────────────

async function setTypedPhone(field: FlagField, el: HTMLInputElement, value: string): Promise<SetResult> {
  let national = digits(value);
  if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (!national) return fail(field.name, "no digits in the phone value");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const box = (locateFlagField(field) as HTMLInputElement | null) ?? el;
    await typeText(box, national);
    blur(box);
    await sleep(400);
    const now = locateFlagField(field) as HTMLInputElement | null;
    const shown = now?.value ?? "";
    if (now && digits(shown).endsWith(national) && !requiredError(now)) {
      return ok(field.name, `typed phone (${shown})`);
    }
    dbg(`  phone ${field.name}: attempt ${attempt} shows "${shown}" ${requiredError(now ?? box)}`);
  }
  const now = (locateFlagField(field) as HTMLInputElement | null) ?? el;
  return fail(
    field.name,
    `typed the number but FLAG did not keep it (shows "${now.value}"${requiredError(now) ? `, ${requiredError(now)}` : ""})`,
  );
}

// ── radio / checkbox ────────────────────────────────────────────────────────

function radiosNamed(name: string): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
}

function labelFor(input: HTMLInputElement): HTMLElement | null {
  if (input.id) {
    const byFor = document.querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (byFor) return byFor;
  }
  const wrap = input.closest("label");
  if (wrap) return wrap as HTMLElement;
  const next = input.nextElementSibling;
  return next && next.tagName === "LABEL" ? (next as HTMLElement) : null;
}

function optionText(input: HTMLInputElement): string {
  return (labelFor(input)?.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function pickOption(radios: HTMLInputElement[], value: string): HTMLInputElement | null {
  const want = value.trim().toLowerCase();
  return (
    radios.find((r) => r.value === value) ??
    radios.find((r) => r.value.toLowerCase() === want) ??
    radios.find((r) => optionText(r) === want) ??
    null
  );
}

function realClick(el: HTMLElement): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

/** Tick an option by its label, re-reading the group each time because FLAG re-renders it. */
async function clickUntilChecked(find: () => HTMLInputElement | null): Promise<boolean> {
  for (let attempt = 1; attempt <= RADIO_ATTEMPTS; attempt++) {
    const input = find();
    if (!input) return false;
    if (input.checked) return true;
    const label = labelFor(input);
    if (attempt === 1 && label) label.click();
    else if (attempt === 2 && label) realClick(label);
    else input.click();
    await sleep(200);
    if (find()?.checked) return true;
  }
  return !!find()?.checked;
}

export async function setLabelRadio(name: string, value: string): Promise<SetResult> {
  const radios = radiosNamed(name);
  if (!radios.length) return fail(name, "element not on page");
  const chosen = pickOption(radios, value);
  if (!chosen) {
    const offered = radios.map((r) => r.value).join(", ");
    return fail(name, `no option "${value}" (FLAG offers ${offered})`);
  }
  if (chosen.checked) return ok(name, "already set");
  if (lockedByPage(chosen)) return fail(name, LOCKED_MESSAGE);
  const want = chosen.value;
  const done = await clickUntilChecked(() => pickOption(radiosNamed(name), want));
  return done ? ok(name, "set radio") : fail(name, `clicked "${value}" ${RADIO_ATTEMPTS} times, FLAG did not take it`);
}

async function setLabelCheckbox(field: FlagField, el: HTMLInputElement, value: string): Promise<SetResult> {
  const want = value.trim().toLowerCase();
  const tick = want === "true" || want === "1" || want === "yes" || want === "on";
  if (!tick && want !== "false") return ok(field.name, "left as it is");
  if (el.checked === tick) return ok(field.name, "already set");
  if (lockedByPage(el)) return fail(field.name, LOCKED_MESSAGE);
  const find = () => locateFlagField(field) as HTMLInputElement | null;
  for (let attempt = 1; attempt <= RADIO_ATTEMPTS; attempt++) {
    const box = find();
    if (!box) break;
    if (box.checked === tick) return ok(field.name, tick ? "ticked" : "unticked");
    const label = labelFor(box);
    if (attempt === 1 && label) label.click();
    else if (attempt === 2 && label) realClick(label);
    else box.click();
    await sleep(200);
  }
  return find()?.checked === tick
    ? ok(field.name, tick ? "ticked" : "unticked")
    : fail(field.name, "FLAG did not take the tick");
}

// ── react-autosuggest (NAICS, SOC) ──────────────────────────────────────────

function suggestions(el: HTMLElement): HTMLElement[] {
  const owner = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  const list = owner ? document.getElementById(owner) : null;
  const scope: ParentNode = list ?? document;
  return Array.from(
    scope.querySelectorAll<HTMLElement>('li[id^="react-autowhatever"], [id^="react-autowhatever"][role="option"]'),
  );
}

function codeRank(text: string, code: string): number {
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  const c = code.toLowerCase();
  if (!/\.\d+$/.test(c) && t.startsWith(`${c}.00`)) return 0;
  if (t.startsWith(c) && !/[0-9.]/.test(t.charAt(c.length))) return 1;
  if (t.startsWith(c)) return 2;
  return -1;
}

function bestSuggestion(options: HTMLElement[], code: string): number {
  let best = -1;
  let bestRank = Infinity;
  options.forEach((opt, i) => {
    const rank = codeRank(opt.textContent ?? "", code);
    if (rank >= 0 && rank < bestRank) {
      best = i;
      bestRank = rank;
    }
  });
  return best;
}

async function waitForSuggestions(el: HTMLElement, code: string): Promise<HTMLElement[]> {
  const deadline = Date.now() + SUGGEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const opts = suggestions(el);
    if (opts.length && bestSuggestion(opts, code) >= 0) return opts;
    await sleep(POLL_MS);
  }
  return suggestions(el);
}

function shownWithoutInput(container: HTMLElement, input: HTMLInputElement): string {
  return ((container.textContent ?? "") + " " + input.value).toLowerCase();
}

async function pickCode(field: FlagField, code: string): Promise<SetResult> {
  const el = locateFlagField(field) as HTMLInputElement | null;
  if (!el) return fail(field.name, "element not on page");
  if (lockedByPage(el)) return fail(field.name, LOCKED_MESSAGE);
  const container = fieldContainer(el, field.boxPrefix);
  const bare = code.replace(/\.00$/, "").toLowerCase();
  if (!field.multi && el.value.toLowerCase().startsWith(bare)) return ok(field.name, `already ${el.value}`);
  if (field.multi && (container.textContent ?? "").toLowerCase().includes(bare)) {
    return ok(field.name, `${code} already picked`);
  }

  await typeText(el, code);
  const options = await waitForSuggestions(el, code);
  const index = bestSuggestion(options, code);
  if (index < 0) {
    const seen = options.slice(0, 3).map((o) => (o.textContent ?? "").trim()).join(" | ");
    clear(el);
    blur(el);
    return fail(field.name, `FLAG offered no option starting with ${code}${seen ? ` (saw: ${seen})` : ""}`);
  }
  const box = (locateFlagField(field) as HTMLInputElement | null) ?? el;
  for (let i = 0; i <= index; i++) {
    press(box, "ArrowDown");
    await sleep(60);
  }
  press(box, "Enter");
  await sleep(500);

  const now = (locateFlagField(field) as HTMLInputElement | null) ?? box;
  const closed = suggestions(now).length === 0;
  const shown = shownWithoutInput(fieldContainer(now, field.boxPrefix), now);
  const took = field.multi ? closed && shown.includes(bare) : closed && (shown.includes(bare) || !!now.value);
  if (!took) {
    return fail(field.name, `picked ${code} with the keyboard but FLAG does not show it`);
  }
  if (!field.multi) blur(now);
  return ok(field.name, `picked ${(options[index].textContent ?? "").trim().slice(0, 60)}`);
}

async function setAutosuggest(field: FlagField, value: string): Promise<SetResult> {
  const codes = field.multi ? value.split(/[;,]/).map((c) => c.trim()).filter(Boolean) : [value.trim()];
  const done: string[] = [];
  for (const code of codes) {
    const res = await pickCode(field, code);
    if (!res.success) {
      return fail(field.name, done.length ? `${done.join(", ")} picked; ${code}: ${res.message}` : res.message);
    }
    done.push(code);
  }
  return ok(field.name, field.multi ? `picked ${done.join(", ")}` : `picked ${done[0]}`);
}

// ── react-select (county, BLS area) ─────────────────────────────────────────

function selectContainer(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (/(^|\s)[\w-]*container\b/i.test(node.className || "") && node.querySelector("input")) return node;
  }
  return el.parentElement?.parentElement ?? el;
}

function visibleSelectInput(el: HTMLElement): HTMLInputElement | null {
  if (el instanceof HTMLInputElement && el.type !== "hidden") return el;
  return selectContainer(el).querySelector<HTMLInputElement>('input:not([type="hidden"])');
}

function selectOptions(container: HTMLElement): HTMLElement[] {
  const inside = Array.from(container.querySelectorAll<HTMLElement>('[id*="-option-"], [class*="option"]'));
  if (inside.length) return inside.filter((o) => !o.querySelector('[id*="-option-"]'));
  return Array.from(document.querySelectorAll<HTMLElement>('[class*="menu"] [id*="-option-"]'));
}

function optionMatches(text: string, name: string): number {
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (t === n) return 0;
  if (t === `${n} county` || t === `${n} parish` || t === `${n} borough`) return 1;
  if (t.startsWith(`${n} `) || t.startsWith(`${n},`)) return 2;
  return -1;
}

function committedSelectValue(container: HTMLElement): string {
  const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (hidden?.value) return hidden.value;
  const single = container.querySelector<HTMLElement>('[class*="singleValue"], [class*="single-value"]');
  return (single?.textContent ?? "").trim();
}

export async function setReactSelect(name: string, target: HTMLElement, value: string): Promise<SetResult> {
  const input = visibleSelectInput(target);
  if (!input) return fail(name, "element not on page");
  if (lockedByPage(input)) return fail(name, LOCKED_MESSAGE);
  const container = selectContainer(input);
  const current = committedSelectValue(container);
  if (current && optionMatches(current, value) >= 0) return ok(name, `already ${current}`);

  await typeText(input, value);
  const deadline = Date.now() + SUGGEST_TIMEOUT_MS;
  let options: HTMLElement[] = [];
  let index = -1;
  while (Date.now() < deadline) {
    options = selectOptions(selectContainer(input));
    let bestRank = Infinity;
    index = -1;
    options.forEach((o, i) => {
      const rank = optionMatches(o.textContent ?? "", value);
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank;
        index = i;
      }
    });
    if (index >= 0) break;
    await sleep(POLL_MS);
  }
  if (index < 0) {
    press(input, "Escape");
    const seen = options.slice(0, 3).map((o) => (o.textContent ?? "").trim()).join(" | ");
    return fail(name, `no "${value}" in FLAG's list${seen ? ` (saw: ${seen})` : " (is the state set?)"}`);
  }
  for (let i = 0; i < index; i++) {
    press(input, "ArrowDown");
    await sleep(60);
  }
  press(input, "Enter");
  await sleep(500);
  const committed = committedSelectValue(selectContainer(input));
  if (!committed) return fail(name, `chose "${value}" but FLAG kept no value`);
  return ok(name, `picked ${(options[index].textContent ?? "").trim()} (${committed})`);
}

// ── entry point ─────────────────────────────────────────────────────────────

async function typeFallbackText(field: FlagField, el: HTMLElement, value: string): Promise<SetResult> {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return fail(field.name, "not a text input");
  }
  if (lockedByPage(el)) return fail(field.name, LOCKED_MESSAGE);
  await typeText(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  blur(el);
  return el.value === value ? ok(field.name, "set text") : fail(field.name, "could not set value");
}

/** Set one descriptor field the way FLAG's widget for it actually saves. */
export async function setFlagValue(field: FlagField, value: string): Promise<SetResult> {
  try {
    if (field.widget === "label-click" && field.kind === "radio") return await setLabelRadio(field.name, value);
    if (field.widget === "autosuggest") return await setAutosuggest(field, value);

    const el = locateFlagField(field);
    if (field.widget === "react-select") {
      return el ? await setReactSelect(field.name, el, value) : fail(field.name, "element not on page");
    }
    if (field.widget === "typed-phone") {
      if (!(el instanceof HTMLInputElement)) return fail(field.name, "element not on page");
      if (lockedByPage(el)) return fail(field.name, LOCKED_MESSAGE);
      return await setTypedPhone(field, el, value);
    }
    if (field.widget === "label-click" && field.kind === "checkbox") {
      if (!(el instanceof HTMLInputElement)) return fail(field.name, "element not on page");
      return await setLabelCheckbox(field, el, value);
    }
    if (el && field.afterName && el.getAttribute("name") !== field.name) {
      return await typeFallbackText(field, el, value);
    }
    return await setValue(flagFieldSpec(field), value);
  } catch (err) {
    return fail(field.name, `error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
