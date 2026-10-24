import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("tools/flag-h3-probe.js", "utf-8");

const radios = (name: string, values: string[]) =>
  values.map((v) => `<input type="radio" name="${name}" value="${v}" />`).join("");

/** Section H as FLAG serves it: H.3 absent until H.1 or H.2 is YES. */
let handler: ((e: Event) => void) | null = null;

function page(revealOn: string[]) {
  // Body listeners survive an innerHTML reset, so without this the previous
  // test's reveal rule is still attached and answers for this one.
  if (handler) document.body.removeEventListener("click", handler);
  document.body.innerHTML = radios("h1_is_dependent", ["YES", "NO"]) +
    radios("h2_is_willful_violator", ["YES", "NO"]);
  handler = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "radio") return;
    el.checked = true;
    const shouldShow = revealOn.some(
      (n) => (document.querySelector(`input[name="${n}"]:checked`) as HTMLInputElement)?.value === "YES",
    );
    const present = document.querySelector('[name="h3_only_h1b"]');
    if (shouldShow && !present) {
      setTimeout(() => document.body.insertAdjacentHTML("beforeend", radios("h3_only_h1b", ["YES", "NO"])), 5);
    } else if (!shouldShow && present) {
      document.querySelectorAll('[name="h3_only_h1b"]').forEach((n) => n.remove());
    }
  };
  document.body.addEventListener("click", handler);
}

const load = () => {
  (window as any).__h3ProbeSettleMs = 40; // real page waits 1500ms per answer
  (0, eval)(SRC);
  return (window as any).__h3Probe;
};

describe("the H.3 probe", () => {
  beforeEach(() => { delete (window as any).__h3Probe; });

  it("reports CONFIRMED when H.2 alone reveals H.3", async () => {
    page(["h1_is_dependent", "h2_is_willful_violator"]);
    const r = await load().run();
    expect(r.h3AppearsOnH2Alone).toBe(true);
    expect(r.appearedAfterH2Yes).toContain("h3_only_h1b");
  });

  it("reports NOT CONFIRMED when only H.1 reveals it", async () => {
    page(["h1_is_dependent"]);
    const r = await load().run();
    expect(r.h3AppearsOnH2Alone).toBe(false);
  });

  it("puts both answers back as it found them", async () => {
    page(["h1_is_dependent", "h2_is_willful_violator"]);
    (document.querySelector('input[name="h1_is_dependent"][value="YES"]') as HTMLInputElement).checked = true;
    (document.querySelector('input[name="h2_is_willful_violator"][value="NO"]') as HTMLInputElement).checked = true;
    const probe = load();
    await probe.run();
    expect(probe.checkedValue("h1_is_dependent")).toBe("YES");
    expect(probe.checkedValue("h2_is_willful_violator")).toBe("NO");
  });
});
