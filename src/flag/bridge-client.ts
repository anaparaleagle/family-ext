import { dbg } from "../engine/logger";

const REQUEST = "mk-flag-bridge";
const DONE = "mk-flag-bridge-done";
const TARGET_ATTR = "data-mk-flag-target";
const TIMEOUT_MS = 8000;

export interface BridgeReply {
  ok: boolean;
  message: string;
}

let seq = 0;

export function bridgeReady(): boolean {
  return document.documentElement.getAttribute("data-mk-flag-bridge") === "1";
}

/** Run one op in the page's MAIN world. Null when the bridge is not loaded or did not answer. */
export async function bridge(
  op: string,
  args: Record<string, unknown> = {},
  el?: Element | null,
): Promise<BridgeReply | null> {
  if (!bridgeReady()) return null;
  const id = `mk${Date.now()}-${++seq}`;
  if (el) el.setAttribute(TARGET_ATTR, id);
  try {
    return await new Promise<BridgeReply | null>((resolve) => {
      const timer = setTimeout(() => {
        document.removeEventListener(DONE, onDone);
        dbg(`  bridge ${op}: no answer`);
        resolve(null);
      }, TIMEOUT_MS);
      function onDone(e: Event): void {
        let reply: { id?: string } & BridgeReply;
        try {
          reply = JSON.parse(String((e as CustomEvent).detail));
        } catch {
          return;
        }
        if (reply.id !== id) return;
        clearTimeout(timer);
        document.removeEventListener(DONE, onDone);
        resolve({ ok: !!reply.ok, message: String(reply.message ?? "") });
      }
      document.addEventListener(DONE, onDone);
      document.dispatchEvent(
        new CustomEvent(REQUEST, { detail: JSON.stringify({ id, op, ...args, ...(el ? { target: id } : {}) }) }),
      );
    });
  } finally {
    if (el) el.removeAttribute(TARGET_ATTR);
  }
}
