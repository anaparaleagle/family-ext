/* eslint-disable no-console */
// ===========================================================================
// FLAG FIELD CAPTURE — a live DOM scraper for the two DOL PERM forms
// (ETA-9141 and ETA-9089) on flag.dol.gov.
//
// WHY THIS EXISTS
// ---------------
// A descriptor is only as good as the capture it was written from. The myUSCIS
// descriptors survived contact with the live forms because they were authored
// from a two-pass capture: pass 1 records the form's UNCONDITIONAL shape, pass 2
// answers each gating question and records what APPEARS. The first PERM capture
// we have (eta9141-COMPLETE / eta9089-COMPLETE) is pass 1 only, and its
// `revealedBy` is a cartesian dump of every radio on the form rather than a real
// reveal map. ~100 boxes that the backend map already knows about were never
// reached, all of them behind a Yes/No.
//
// This script does both passes and derives `revealedBy` by DIFFING the field set
// before and after each answer, so a reveal is observed rather than guessed.
//
// HOW TO RUN
// ----------
//   1. Open a THROWAWAY 9141 or 9089 draft on flag.dol.gov. Not a real filing:
//      this types junk answers into every gating question. FLAG autosaves.
//   2. Paste this whole file into the DevTools console on that page.
//   3. await __flagCapture.run()
//   4. __flagCapture.save()   // downloads the JSON
//
// Long forms: `run()` takes minutes and logs progress. Re-runnable.
//
// WHAT IT WILL NOT DO
// -------------------
// It never clicks a control whose label looks like Submit / Sign / Certify /
// Delete / Withdraw / Pay (see FORBIDDEN). A capture that submits an application
// to DOL is worse than no capture, and FLAG gives no undo.
// ===========================================================================

(() => {
  // ── tunables ─────────────────────────────────────────────────────────────
  const SETTLE_MS = 450; // how long to let React re-render after an answer
  const NAV_SETTLE_MS = 1200; // section switches fetch, so they need longer
  const MAX_PROBES_PER_SECTION = 40; // runaway guard
  // A select with more options than this is a lookup list (state, country, class
  // of admission), not a branch. Walking one costs minutes and reveals nothing.
  const SELECT_GATE_MAX_OPTIONS = 12;

  // Any control matching this is never clicked, never set. Non-negotiable.
  const FORBIDDEN =
    /\b(submit|sign|certify|declare|delete|withdraw|cancel|pay|payment|final)\b/i;

  // The box-number prefix every FLAG label carries: "B.1.", "E.3b.", "F.e.5.",
  // "F.b.1.a.", "F.a.8.a.".
  //
  // The trailing sub-item is NOT optional decoration. "F.b.1.a." and "F.b.1.b."
  // are two different boxes ("specify the other degree" and "indicate the
  // major"), and a pattern that stops at the digit collapses them into one — the
  // second silently overwrites the first in the table. Same for the 9089's
  // "F.a.8." vs "F.a.8.a." (MSA area code vs area title).
  const BOX_RE = /^((?:APX\s*)?[A-Z](?:\.[a-zA-Z])?\.\d+(?:\.?[a-z])?)\./;

  // A nav section that RESTARTS the numbering: "APX A.A Appendix A.A - Foreign
  // Worker Contact Information".
  //
  // This is the single most important line in the file. The ETA-9089 numbers
  // Section A (Employer Information) A.1-A.17 and Appendix A.A (Foreign Worker
  // Contact Information) A.1-A.15 — the same box numbers, different boxes. The
  // backend's first attempt at this table keyed on the bare box number, every
  // key still resolved to a real map entry so nothing looked wrong, and A.1
  // pointed at the foreign worker's last-name input: the employer's legal
  // business name would have been typed into the beneficiary's name box on a
  // federal form. Capture the qualifier or the capture is a trap.
  const APX_RE = /^APX\s*([A-Z](?:\.[A-Z])?)/;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  /**
   * The backend's map-entry-id shape: "A1", "Fa8a", "APXAA1".
   *
   * Inside an appendix the box's own leading letter DUPLICATES the appendix
   * letter — Appendix A.A prints its first box as "A.1." — so the letter is
   * dropped and the appendix code supplies it. Without that, "APX A.A" + "A.1"
   * spells APXAAA1, which is not what anyone would write by hand and would not
   * match a map entry added later.
   */
  const idOf = (box, sectionName) => {
    const apx = APX_RE.exec(sectionName || "");
    if (!apx) return box.replace(/[^A-Za-z0-9]/g, "");
    const item = box.replace(/^[A-Z](\.[a-zA-Z])?\./, ""); // "A.1" -> "1"
    return `APX${apx[1]}${item}`.replace(/[^A-Za-z0-9]/g, "");
  };

  // ── element identity ─────────────────────────────────────────────────────

  /**
   * A stable key for one input. Prefers `name`, then `id`, and only then falls
   * back to a positional path.
   *
   * The fallback matters: the SOC and NAICS comboboxes on both forms have
   * NEITHER a name nor an id, and the first capture recorded them as 12-deep
   * `nth-of-type` chains that will not survive a FLAG release. Recording them
   * as `combobox@<label>` at least tells the descriptor author that this field
   * needs a hand-written locate strategy rather than a selector.
   */
  function keyOf(el, label) {
    if (el.name) return el.name;
    if (el.id) return el.id;
    const role = el.getAttribute("role");
    if (role === "combobox" || el.getAttribute("aria-autocomplete")) {
      return `combobox@${label || "(unlabelled)"}`;
    }
    return `${el.tagName.toLowerCase()}@${label || "(unlabelled)"}`;
  }

  /** The visible label for an input: <label for>, wrapping label, or legend. */
  function labelOf(el) {
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return norm(forLabel.textContent);
    }
    const wrapping = el.closest("label");
    if (wrapping) return norm(wrapping.textContent);
    // FLAG wraps a question and its input in a div; the question text is
    // usually the first block element inside that group.
    const group = el.closest("fieldset, .form-group, [class*='question']");
    if (group) {
      const legend = group.querySelector("legend, label, p, h4, h5");
      if (legend) return norm(legend.textContent);
    }
    return norm(el.getAttribute("aria-label") || el.placeholder || "");
  }

  /** Is this element actually on screen? FLAG keeps hidden sections mounted. */
  function visible(el) {
    if (el.type === "hidden") return false;
    if (el.offsetParent !== null) return true;
    // offsetParent is null for position:fixed too, so double-check.
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // ── field enumeration ────────────────────────────────────────────────────

  /**
   * Every fillable control currently rendered, radios collapsed into one entry
   * per group.
   *
   * A radio GROUP is the unit that matters: `coveredByAcwia` is one question
   * with a Yes and a No input, and the first capture recorded only whichever
   * input it hit first (always the Yes), losing the option list. Here the group
   * carries all its option values, taken from the `value` attribute — NOT from
   * the id. FLAG builds radio ids as `<name>_<label>` and some of those labels
   * are raw HTML (`jobOppPWDAttached_<span style='color:#707275'>Yes</span>`) or
   * a full sentence of regulation text (`occupationType_1a. This application
   * is for a <b>professional occupation</b>...`). Selecting by id is therefore
   * not an option; the descriptor must select by name+value.
   */
  function snapshot(sectionName) {
    const fields = new Map();
    const radioGroups = new Map();

    const controls = document.querySelectorAll(
      "input, select, textarea, [role='combobox']",
    );

    for (const el of controls) {
      if (!visible(el)) continue;
      const label = labelOf(el);

      if (el.type === "radio" || el.type === "checkbox") {
        const groupName = el.name || `_anon_${label}`;
        if (!radioGroups.has(groupName)) {
          radioGroups.set(groupName, {
            key: groupName,
            kind: el.type,
            label: "",
            box: null,
            options: [],
            checked: null,
          });
        }
        const group = radioGroups.get(groupName);
        group.options.push({ value: el.value, label, id: el.id || null });
        if (el.checked) group.checked = el.value;
        // The group's own question text is the shortest common ancestor's
        // legend, not the per-option label ("Yes"). Take the fieldset legend.
        if (!group.label) {
          const fs = el.closest("fieldset, .form-group, [class*='question']");
          const legend = fs?.querySelector("legend, label:not([for]), p, h4, h5");
          group.label = norm(legend?.textContent) || label;
        }
        continue;
      }

      const key = keyOf(el, label);
      if (fields.has(key)) continue;
      fields.set(key, {
        key,
        kind:
          el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")
            ? "search"
            : el.tagName === "SELECT"
              ? "select"
              : el.tagName === "TEXTAREA"
                ? "textarea"
                : el.type || "text",
        label,
        box: null,
        name: el.name || null,
        id: el.id || null,
        required: el.required || el.getAttribute("aria-required") === "true",
        disabled: el.disabled,
        // Recorded so a select gate can be put back after probing, and so a
        // draft that turns out NOT to be blank is visible in the capture rather
        // than being mistaken for the form's default state.
        current: el.tagName === "SELECT" ? el.value : undefined,
        options:
          el.tagName === "SELECT"
            ? [...el.options].map((o) => ({ value: o.value, label: norm(o.text) }))
            : undefined,
      });
    }

    for (const group of radioGroups.values()) fields.set(group.key, group);

    // Attach the box number and the map-entry id it joins to.
    //
    // A radio's box number lives on the FIELDSET LEGEND, not on the per-option
    // label — which is exactly why the earlier capture produced no box number
    // for a single radio on either form, and why every radio is still missing
    // from the backend table. `group.label` above is the legend, so this is the
    // pass that fixes that.
    for (const f of fields.values()) {
      const m = BOX_RE.exec(f.label);
      if (m) {
        f.box = m[1].replace(/\s+/g, "");
        f.mapId = idOf(f.box, sectionName);
      }
    }
    return fields;
  }

  // ── setting a value (FLAG-flavoured) ─────────────────────────────────────
  //
  // Ported from the H-1B extension's lca-filler, which learned this on the LCA:
  // FLAG's inputs are React-controlled, so assigning `.value` is silently
  // reverted on the next render. The native setter plus an input+change pair is
  // what actually commits; selects additionally need `_valueTracker` cleared or
  // React treats the change as a no-op.

  function setNative(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue("");
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clickRadio(name, value) {
    const el = document.querySelector(
      `input[name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`,
    );
    if (!el || !visible(el)) return false;
    if (FORBIDDEN.test(labelOf(el))) return false;
    el.click();
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function findSelect(nameOrId) {
    return (
      document.querySelector(`select[name="${CSS.escape(nameOrId)}"]`) ||
      document.querySelector(`select#${CSS.escape(nameOrId)}`)
    );
  }

  /** Drive one gate to one value. Returns false when the control is unreachable. */
  function answer(gate, value) {
    if (gate.kind === "radio" || gate.kind === "checkbox") {
      return clickRadio(gate.key, value);
    }
    const el = findSelect(gate.key);
    if (!el || !visible(el)) return false;
    setNative(el, value);
    return true;
  }

  /**
   * The answers worth trying on one gate.
   *
   * Radios: every option. Selects: every real option, but only for a SHORT list
   * — a 218-option country select is not a gate, and walking it would add twenty
   * minutes per section for nothing. The placeholder is skipped because
   * selecting it is what "unanswered" already means.
   */
  function answersFor(gate) {
    const options = (gate.options || []).filter(
      (o) => o.value && !/^-?\s*select\s*-?$/i.test(o.value),
    );
    if (gate.kind === "radio") return options;
    if (gate.kind !== "select") return [];
    return options.length >= 2 && options.length <= SELECT_GATE_MAX_OPTIONS
      ? options
      : [];
  }

  // ── the reveal probe ─────────────────────────────────────────────────────

  /**
   * Answer one gating question every way it can be answered, and record which
   * fields each answer brings on screen.
   *
   * Returns `[{value, revealed: [key]}]`. An answer that reveals nothing is
   * still recorded — a NEGATIVE result is what lets the descriptor author say
   * "No does not hide anything here" instead of leaving it open, and the N-400
   * capture showed that a negative control is what makes a derived rule
   * trustworthy.
   */
  async function probeGate(gate, baseline, sectionName) {
    const results = [];
    const original = gate.kind === "select" ? gate.current : gate.checked;

    for (const opt of answersFor(gate)) {
      if (FORBIDDEN.test(opt.label)) continue;
      if (!answer(gate, opt.value)) continue;
      await sleep(SETTLE_MS);

      const after = snapshot(sectionName);
      const revealed = [...after.keys()].filter((k) => !baseline.has(k));
      results.push({
        value: opt.value,
        label: opt.label,
        revealed,
        revealedFields: revealed.map((k) => after.get(k)),
      });
      if (revealed.length) {
        console.log(`      ${gate.key}=${opt.value} -> +${revealed.length}`, revealed);
      }
    }

    // Put it back, so the next gate is probed against the same baseline and the
    // draft is left roughly as found. An UNANSWERED radio cannot be un-answered
    // — there is no "none" to click — which is one of the reasons a section can
    // fail the baseline check below.
    if (original != null && original !== "") {
      answer(gate, original);
      await sleep(SETTLE_MS);
    }
    return results;
  }

  // ── navigation ───────────────────────────────────────────────────────────

  /**
   * The sidebar section links.
   *
   * Discovered rather than hard-coded: FLAG's markup is not documented and the
   * capture has to survive a redesign. Anything in a nav/aside whose text looks
   * like a section heading counts. The list is logged so the real selector can
   * be pinned in the descriptor later.
   */
  function findNavItems() {
    const candidates = document.querySelectorAll(
      "nav a, nav button, nav li, aside a, aside li, [class*='sidebar'] a," +
        " [class*='sidebar'] li, [class*='stepper'] li, [role='tablist'] [role='tab']",
    );
    const items = [];
    const seen = new Set();
    for (const el of candidates) {
      const text = norm(el.textContent);
      if (!text || text.length > 90) continue;
      if (FORBIDDEN.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      items.push({ text, el });
    }
    return items;
  }

  // ── the run ──────────────────────────────────────────────────────────────

  const capture = {
    url: location.href,
    form: /\/(9141|9089)\//.exec(location.pathname)?.[1] ?? "unknown",
    capturedAt: null,
    navItems: [],
    sections: [],
    warnings: [],
  };

  async function captureSection(sectionName) {
    console.log(`  capturing "${sectionName}"`);
    const baseline = snapshot(sectionName);
    const section = {
      name: sectionName,
      fields: [...baseline.values()],
      reveals: [],
    };

    // Gating questions: every radio group, plus any select short enough to be a
    // real branch rather than a lookup list (see answersFor).
    const gates = [...baseline.values()].filter((f) => answersFor(f).length >= 2);
    if (gates.length > MAX_PROBES_PER_SECTION) {
      capture.warnings.push(
        `"${sectionName}" has ${gates.length} radio groups; probed only the first ${MAX_PROBES_PER_SECTION}.`,
      );
    }

    for (const gate of gates.slice(0, MAX_PROBES_PER_SECTION)) {
      const answers = await probeGate(gate, baseline, sectionName);
      if (answers.some((a) => a.revealed.length)) {
        section.reveals.push({ gate: gate.key, gateLabel: gate.label, answers });
      }
    }

    // Did restoring each gate actually restore the page?
    //
    // Every reveal in this section was diffed against ONE baseline taken at the
    // top. If a gate failed to go back — FLAG refused the click, or answering it
    // committed something that cannot be un-answered — then later gates were
    // diffed against a page that had already moved, and their "revealed" lists
    // are wrong in a way that reads as a discovery. Cheaper to say so than to
    // have a descriptor author trust it.
    const drift = [...snapshot(sectionName).keys()].filter((k) => !baseline.has(k));
    if (drift.length) {
      capture.warnings.push(
        `"${sectionName}" did not return to its baseline — ${drift.length} field(s) ` +
          `still rendered after restoring every gate (${drift.slice(0, 5).join(", ")}). ` +
          `Reveal results for the LATER gates in this section may be contaminated; ` +
          `reload the draft and re-run to confirm them.`,
      );
    }
    return section;
  }

  async function run() {
    capture.capturedAt = new Date().toISOString();
    capture.sections = [];
    capture.warnings = [];

    const nav = findNavItems();
    capture.navItems = nav.map((n) => n.text);
    console.log(`Found ${nav.length} nav items:`, capture.navItems);

    if (!nav.length) {
      capture.warnings.push(
        "No sidebar nav found — captured only the section currently on screen. " +
          "Pin the nav selector in findNavItems() and re-run.",
      );
      capture.sections.push(await captureSection("(current screen)"));
      return capture;
    }

    for (const item of nav) {
      // Re-query: clicking a nav item re-renders the sidebar, so the stored
      // element reference goes stale after the first hop.
      const live = findNavItems().find((n) => n.text === item.text);
      if (!live) {
        capture.warnings.push(`Nav item "${item.text}" vanished after navigation.`);
        continue;
      }
      // Did the click actually change the section?
      //
      // `findNavItems` is a guess at FLAG's markup, so some of what it returns
      // will not be a section link at all. A no-op click that still gets
      // captured produces a duplicate section under the wrong name — and a
      // duplicate looks like real coverage. Fingerprint the rendered field set
      // and skip when it did not move.
      const before = [...snapshot(item.text).keys()].join("|");
      live.el.click();
      await sleep(NAV_SETTLE_MS);
      const after = [...snapshot(item.text).keys()].join("|");
      if (before === after && capture.sections.length) {
        capture.warnings.push(
          `Nav item "${item.text}" changed nothing on screen — not a section link. Skipped.`,
        );
        continue;
      }
      capture.sections.push(await captureSection(item.text));
    }

    const total = capture.sections.reduce((n, s) => n + s.fields.length, 0);
    const revealed = capture.sections.reduce(
      (n, s) =>
        n +
        s.reveals.reduce(
          (m, r) => m + r.answers.reduce((k, a) => k + a.revealed.length, 0),
          0,
        ),
      0,
    );
    console.log(
      `DONE — ${capture.sections.length} sections, ${total} unconditional fields, ` +
        `${revealed} revealed fields, ${capture.warnings.length} warnings.`,
    );
    if (capture.warnings.length) console.warn(capture.warnings);
    return capture;
  }

  /** Every field the run saw, unconditional and revealed alike. */
  function allFields() {
    const seen = new Map();
    for (const s of capture.sections) {
      for (const f of s.fields) seen.set(`${s.name}|${f.key}`, f);
      for (const r of s.reveals)
        for (const a of r.answers)
          for (const f of a.revealedFields || []) seen.set(`${s.name}|${f.key}`, f);
    }
    return [...seen.values()];
  }

  /**
   * Did this run actually improve on the last one? Print before saving.
   *
   * The two numbers that decide it:
   *
   *   radiosWithBoxNumber — the whole point of the reveal pass. The previous
   *     capture got ZERO, so every radio on both forms is still missing from the
   *     backend table and no Yes/No answer can be autofilled. Anything above 0
   *     is new ground.
   *   radiosWithOptionValues — a radio whose `value` attributes we can now read.
   *     Without these, writing to a FLAG radio is a guess, and a wrong guess is
   *     ignored silently rather than raised.
   */
  function coverage() {
    const fields = allFields();
    const radios = fields.filter((f) => f.kind === "radio");
    const report = {
      sections: capture.sections.length,
      fields: fields.length,
      withMapId: fields.filter((f) => f.mapId).length,
      radios: radios.length,
      radiosWithBoxNumber: radios.filter((f) => f.box).length,
      radiosWithOptionValues: radios.filter((f) =>
        (f.options || []).some((o) => o.value),
      ).length,
      // No name, no id — the SOC/NAICS comboboxes. These need a hand-written
      // locate strategy in the descriptor, so knowing the count is knowing how
      // much hand work is left.
      unaddressable: fields.filter((f) => f.key.startsWith("combobox@")).length,
      mapIds: [...new Set(fields.filter((f) => f.mapId).map((f) => f.mapId))].sort(),
      warnings: capture.warnings.length,
    };
    console.table([{ ...report, mapIds: `${report.mapIds.length} distinct` }]);
    if (capture.warnings.length) console.warn(capture.warnings);
    return report;
  }

  function save() {
    const blob = new Blob([JSON.stringify(capture, null, 1)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `eta${capture.form}-reveals-${Date.now()}.json`;
    a.click();
  }

  window.__flagCapture = { run, save, coverage, capture, allFields, snapshot, findNavItems };
  console.log(
    `__flagCapture ready — form ${capture.form}.\n` +
      "  1. await __flagCapture.run()      // walks every section, probes every gate\n" +
      "  2. __flagCapture.coverage()       // did it beat the last capture?\n" +
      "  3. __flagCapture.save()           // downloads the JSON\n" +
      "Use a THROWAWAY draft: the reveal pass answers every gating question and FLAG autosaves.",
  );
})();
