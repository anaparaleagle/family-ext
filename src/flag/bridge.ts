// Runs in flag.dol.gov's MAIN world. FLAG's radios, suggestion boxes and county lists only
// answer to their React props and value trackers, which the isolated content script cannot see.

type AnyProps = Record<string, unknown>;
type Request = { id: string; op: string; [key: string]: unknown };
type Reply = { ok: boolean; message: string };

const REQUEST = "mk-flag-bridge";
const DONE = "mk-flag-bridge-done";
const TARGET_ATTR = "data-mk-flag-target";
const KEY_CODES: Record<string, number> = { ArrowDown: 40, Enter: 13, Escape: 27 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function reactProps(el: Element | null): AnyProps | null {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? ((el as unknown as Record<string, AnyProps>)[key] ?? null) : null;
}

function synthetic(el: Element, type: string, extra: AnyProps = {}): AnyProps {
  return {
    type,
    target: el,
    currentTarget: el,
    nativeEvent: { type },
    bubbles: true,
    preventDefault() {},
    stopPropagation() {},
    persist() {},
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    ...extra,
  };
}

function call(el: Element, prop: string, evt: AnyProps): boolean {
  const fn = reactProps(el)?.[prop];
  if (typeof fn !== "function") return false;
  (fn as (e: AnyProps) => void)(evt);
  return true;
}

function labelFor(input: HTMLInputElement): HTMLElement | null {
  if (input.id) {
    const byFor = document.querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (byFor) return byFor;
  }
  return (input.closest("label") as HTMLElement | null) ??
    (input.nextElementSibling?.tagName === "LABEL" ? (input.nextElementSibling as HTMLElement) : null);
}

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function target(token: unknown): HTMLElement | null {
  return typeof token === "string"
    ? document.querySelector<HTMLElement>(`[${TARGET_ATTR}="${CSS.escape(token)}"]`)
    : null;
}

function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker) tracker.setValue(value === "" ? "\u0000" : "");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function toggle(input: HTMLInputElement, want: () => boolean): Promise<boolean> {
  const label = labelFor(input);
  const steps: (() => boolean)[] = [
    () => !!label && call(label, "onClick", synthetic(label, "click")),
    () => {
      const next = input.type === "radio" ? true : !input.checked;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(input, next);
      return call(input, "onChange", synthetic(input, "change"));
    },
    () => {
      input.click();
      return true;
    },
  ];
  for (const step of steps) {
    if (want()) return true;
    if (!step()) continue;
    await sleep(250);
    if (want()) return true;
  }
  return want();
}

function radios(name: string): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
}

function matching(name: string, value: string): HTMLInputElement[] {
  const all = radios(name);
  const want = norm(value);
  const byValue = all.filter((r) => norm(r.value) === want);
  return byValue.length ? byValue : all.filter((r) => norm(labelFor(r)?.textContent) === want);
}

async function radio(req: Request): Promise<Reply> {
  const name = String(req.name);
  const value = String(req.value);
  if (!radios(name).length) return { ok: false, message: "element not on page" };
  const isSet = () => matching(name, value).some((r) => r.checked);
  if (!matching(name, value).length) {
    return { ok: false, message: `no option "${value}" (FLAG offers ${radios(name).map((r) => r.value).join(", ")})` };
  }
  if (isSet()) return { ok: true, message: "already set" };
  const pick = matching(name, value).filter((r) => !r.disabled);
  const input = pick.find((r) => visible(labelFor(r) ?? r)) ?? pick[0];
  if (!input) return { ok: false, message: "locked" };
  return (await toggle(input, isSet))
    ? { ok: true, message: "set radio" }
    : { ok: false, message: `FLAG did not take "${value}"` };
}

async function checkbox(req: Request): Promise<Reply> {
  const input = target(req.target) as HTMLInputElement | null;
  if (!input) return { ok: false, message: "element not on page" };
  const want = !!req.want;
  if (input.checked === want) return { ok: true, message: "already set" };
  if (input.disabled) return { ok: false, message: "locked" };
  const find = () => (target(req.target) as HTMLInputElement | null) ?? input;
  return (await toggle(input, () => find().checked === want))
    ? { ok: true, message: want ? "ticked" : "unticked" }
    : { ok: false, message: "FLAG did not take the tick" };
}

async function setInput(req: Request): Promise<Reply> {
  const el = target(req.target) as HTMLInputElement | null;
  if (!el) return { ok: false, message: "element not on page" };
  const value = String(req.value ?? "");
  el.focus();
  call(el, "onFocus", synthetic(el, "focus"));
  setNative(el, value);
  if (el.value !== value) call(el, "onChange", synthetic(el, "change"));
  return { ok: el.value === value, message: `box shows "${el.value}"` };
}

function keyEvent(type: string, key: string): KeyboardEvent {
  const evt = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
  Object.defineProperty(evt, "keyCode", { get: () => KEY_CODES[key] ?? 0 });
  Object.defineProperty(evt, "which", { get: () => KEY_CODES[key] ?? 0 });
  return evt;
}

async function key(req: Request): Promise<Reply> {
  const el = target(req.target);
  if (!el) return { ok: false, message: "element not on page" };
  const name = String(req.key);
  const times = Math.max(1, Number(req.times ?? 1));
  for (let i = 0; i < times; i++) {
    el.dispatchEvent(keyEvent("keydown", name));
    el.dispatchEvent(keyEvent("keyup", name));
    await sleep(60);
  }
  return { ok: true, message: `pressed ${name} x${times}` };
}

async function click(req: Request): Promise<Reply> {
  const el = target(req.target);
  if (!el) return { ok: false, message: "element not on page" };
  if (call(el, "onClick", synthetic(el, "click"))) return { ok: true, message: "onClick" };
  if (call(el, "onMouseDown", synthetic(el, "mousedown", { button: 0 }))) return { ok: true, message: "onMouseDown" };
  el.click();
  return { ok: true, message: "click" };
}

function blur(req: Request): Promise<Reply> {
  const el = target(req.target);
  if (!el) return Promise.resolve({ ok: false, message: "element not on page" });
  call(el, "onBlur", synthetic(el, "blur"));
  (el as HTMLElement).blur();
  return Promise.resolve({ ok: true, message: "blurred" });
}

const OPS: Record<string, (req: Request) => Promise<Reply>> = { radio, checkbox, setInput, key, click, blur };

document.addEventListener(REQUEST, (e: Event) => {
  let req: Request;
  try {
    req = JSON.parse(String((e as CustomEvent).detail)) as Request;
  } catch {
    return;
  }
  const op = OPS[req.op];
  const reply = (r: Reply) =>
    document.dispatchEvent(new CustomEvent(DONE, { detail: JSON.stringify({ id: req.id, ...r }) }));
  if (!op) {
    reply({ ok: false, message: `unknown op ${req.op}` });
    return;
  }
  op(req).then(reply, (err) => reply({ ok: false, message: `bridge error: ${String(err)}` }));
});

document.documentElement.setAttribute("data-mk-flag-bridge", "1");

export {};
