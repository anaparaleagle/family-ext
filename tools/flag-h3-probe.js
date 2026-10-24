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
//
//      SECTION H RENDERS NOTHING until A.1 (visa classification) says H-1B —
//      it shows "Please specify the type of visa classification ... in Field
//      A.1" and no questions at all. Fill A.1 first on a fresh draft. Not a
//      problem for the extension, which fills A.1 on its way past Section A,
//      but it will stop this probe dead.
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

    // Put the draft back as it was found — as far as that is possible. A FLAG
    // radio has no "unanswered" option, so a question that started blank CANNOT
    // be put back: this probe's own answer stays on the draft, and FLAG has
    // autosaved it. Say so plainly. The first run of this said "restored" and
    // printed the current values, which read as a successful restore of a draft
    // it had in fact changed.
    const stuck = [];
    for (const [name, value] of Object.entries(was)) {
      if (value) await set(name, value);
      else stuck.push(name);
    }
    const now = { [H1]: checkedValue(H1), [H2]: checkedValue(H2) };
    if (stuck.length) {
      console.warn(
        "LEFT BEHIND — these started unanswered and a radio cannot be cleared, " +
          "so this probe's answers are now saved on the draft. Clear them by " +
          "hand, or discard the draft:",
        stuck.map((n) => `${n}=${now[n]}`).join(", "),
      );
    } else {
      console.log("restored to the starting answers:", now);
    }
    result.leftBehind = stuck;
    return result;
  }

  /**
   * What H.3 itself reveals, each way.
   *
   * The capture says Yes opens H.4 (the statutory basis for the exemption) and
   * No opens H.5 and H.6 (the Appendix A question and the additional-statements
   * attestation). Those gates were recorded in the same session that missed the
   * H.2 half of H.3, so they are worth a second look rather than a second
   * assumption — especially H.5, which the descriptor reads as appearing on NO
   * while the box itself is about a master's-degree exemption.
   *
   * Leaves H.3 answered: a radio cannot be cleared. Throwaway drafts only.
   */
  async function downstream() {
    if (!radio("h3_only_h1b", "YES")) {
      console.error("H.3 is not on screen. Answer H.1 or H.2 Yes first, or run run().");
      return null;
    }
    const base = onScreen();
    await set("h3_only_h1b", "YES");
    const onYes = [...onScreen()].filter((n) => !base.has(n));
    await set("h3_only_h1b", "NO");
    const onNo = [...onScreen()].filter((n) => !base.has(n));

    const result = { revealedByYes: onYes, revealedByNo: onNo };
    console.log(result);
    console.warn("H.3 is left answered NO on this draft — a radio cannot be cleared.");
    return result;
  }

  /**
   * Which H.4 answer brings out H.5 (the Appendix A question)?
   *
   * The capture put H.5 behind H.3 = No, and a live read on 2026-10-24 shows
   * H.3 = No bringing out Subsection 2 and H.6 — with no H.5 anywhere. DOL's
   * box asks about a worker exempt ONLY by a master's degree, which is an H.4
   * answer, not an H.3 one; the backend map already reads it that way ("N/A
   * unless the exemption rests on the degree alone"). So this walks all three
   * bases and reports where H.5 actually shows up.
   *
   * Leaves H.3 Yes and H.4 on the last basis tried. Throwaway drafts only.
   */
  async function appendixA() {
    const BASES = [
      "$60,000 or higher annual wage",
      "Master's Degree or higher in related speciality",
      "Both",
    ];
    if (!radio("h3_only_h1b", "YES")) {
      console.error("H.3 is not on screen. Answer H.1 or H.2 Yes first.");
      return null;
    }
    const found = {};
    for (const basis of BASES) {
      await set("h3_only_h1b", "YES");
      if (!radio("h4_exemption_basis", basis)) {
        found[basis] = "no such option on this page — check the exact label";
        continue;
      }
      await set("h4_exemption_basis", basis);
      found[basis] = [...onScreen()].filter((n) => n.startsWith("h5"));
    }
    console.log(found);
    console.warn("H.3 and H.4 are left answered on this draft.");
    return found;
  }

  window.__h3Probe = { run, downstream, appendixA, onScreen, checkedValue };
  console.log(
    "__h3Probe ready\n" +
      "  await __h3Probe.run()         // does H.2 alone reveal H.3?\n" +
      "  await __h3Probe.downstream()  // what does H.3 itself reveal, each way?\n" +
      "  await __h3Probe.appendixA()   // which H.4 basis brings out H.5?",
  );
})();
