/* eslint-disable no-console */
// ===========================================================================
// ETA-9035 SECTION H — does H.2 alone reveal H.3?
//
// WHY THIS EXISTS
// ---------------
// DOL prints the rule for H.3 as "If Yes to H.1 AND/OR H.2". The 2026-10-08
// capture only ever toggled H.1, so the descriptor was written as "H.1 only" —
// and an employer that is a willful violator WITHOUT being H-1B dependent lost
// H.3 to a gate that never opened: a required box left blank, and a section
// FLAG then refuses to save. family-ext #55 reads the gate as H.1 OR H.2 on the
// strength of DOL's wording. This is the observation that wording stands in for.
//
// Use this rather than flag-capture.js when the H section is all you need:
// the full capture walks every section and answers every gate, which takes
// minutes and leaves junk across the whole draft.
//
// HOW TO RUN
// ----------
//   1. Open a THROWAWAY 9035 draft on flag.dol.gov and click to Section H.
//      Not a real filing — this sets H.1 and H.2, and FLAG autosaves.
//   2. Paste this whole file into the DevTools console on that page.
//   3. await __h3Probe.run()
//
// It restores both answers to whatever they were when it started. It never
// clicks Continue, Submit or anything else: it sets two radios and reads.
// ===========================================================================

(() => {
  // FLAG is React: a click SCHEDULES a re-render, it does not perform one, so
  // every answer needs a wait before the page is read. Overridable only so the
  // test for this file does not spend 20 seconds sleeping; nothing sets it on
  // a real page.
  const SETTLE_MS = Number(window.__h3ProbeSettleMs) || 1500;
  const H1 = "h1_is_dependent";
  const H2 = "h2_is_willful_violator";

  const radio = (name, value) =>
    document.querySelector(`input[name="${name}"][value="${value}"]`);

  const checkedValue = (name) =>
    document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  /** Every named control on screen right now. */
  const onScreen = () =>
    new Set(
      [...document.querySelectorAll("input[name], select[name], textarea[name]")]
        .map((el) => el.name)
        .filter(Boolean),
    );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function set(name, value) {
    const el = radio(name, value);
    if (!el) throw new Error(`${name}=${value} is not on this page — is Section H open?`);
    el.click();
    await sleep(SETTLE_MS);
  }

  async function run() {
    if (!radio(H1, "YES") || !radio(H2, "YES")) {
      console.error("Section H is not on screen. Open the H section first.");
      return null;
    }

    const was = { [H1]: checkedValue(H1), [H2]: checkedValue(H2) };
    console.log("starting state:", was);

    // Both No: the ordinary employer, and the baseline H.3 is measured against.
    await set(H1, "NO");
    await set(H2, "NO");
    const baseline = onScreen();
    const h3AtBaseline = baseline.has("h3_only_h1b");

    // The case in question: willful violator, NOT dependent.
    await set(H2, "YES");
    const after = onScreen();
    const appeared = [...after].filter((n) => !baseline.has(n));
    const h3Appeared = after.has("h3_only_h1b");

    const result = {
      h3PresentWithBothNo: h3AtBaseline,
      h3AppearsOnH2Alone: h3Appeared && !h3AtBaseline,
      appearedAfterH2Yes: appeared,
    };

    console.log(
      h3Appeared && !h3AtBaseline
        ? "CONFIRMED — H.2 alone reveals H.3. The fix in family-ext #55 is right."
        : h3AtBaseline
          ? "INCONCLUSIVE — H.3 was already on screen with both answers No, so " +
            "this page does not gate it at all. Report the whole result object."
          : "NOT CONFIRMED — H.2 alone did NOT reveal H.3. The gate really is " +
            "H.1 only, and the backend is sending a value for a box that cannot " +
            "render. Report this.",
    );
    console.log(result);

    // Put the draft back as it was found.
    for (const [name, value] of Object.entries(was)) {
      if (value) await set(name, value);
    }
    console.log("restored:", { [H1]: checkedValue(H1), [H2]: checkedValue(H2) });
    return result;
  }

  window.__h3Probe = { run, onScreen, checkedValue };
  console.log("__h3Probe ready — run:  await __h3Probe.run()");
})();
