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

  // Any control matching this is never clicked, never set. Non-negotiable.
  const FORBIDDEN =
    /\b(submit|sign|certify|declare|delete|withdraw|cancel|pay|payment|final)\b/i;

  // The box-number prefix every FLAG label carries: "B.1.", "F.e.5.",
  // "APX A.11.". This is the join key to the backend's ETA maps — the maps key
  // on exactly these, which is why the label is captured raw as well.
  const BOX_RE = /^((?:APX\s*)?[A-Z](?:\.[a-z])?\.\d+[a-z]?)\./;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

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
  function snapshot() {
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
        options:
          el.tagName === "SELECT"
            ? [...el.options].map((o) => ({ value: o.value, label: norm(o.text) }))
            : undefined,
      });
    }

    for (const group of radioGroups.values()) fields.set(group.key, group);

    // Attach the box number, which is what joins a field to the backend map.
    for (const f of fields.values()) {
      const m = BOX_RE.exec(f.label);
      if (m) f.box = m[1].replace(/\s+/g, "");
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
  async function probeGate(gate, baseline) {
    const results = [];
    const original = gate.checked;

    for (const opt of gate.options) {
      if (FORBIDDEN.test(opt.label)) continue;
      if (!clickRadio(gate.key, opt.value)) continue;
      await sleep(SETTLE_MS);

      const after = snapshot();
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
    // draft is left roughly as found.
    if (original != null) {
      clickRadio(gate.key, original);
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
    const baseline = snapshot();
    const section = {
      name: sectionName,
      fields: [...baseline.values()],
      reveals: [],
    };

    // Gating questions = radio groups. Selects can gate too, but on these two
    // forms every observed reveal hangs off a Yes/No, and driving 200-option
    // country selects to find out otherwise is not worth the run time.
    const gates = [...baseline.values()].filter(
      (f) => f.kind === "radio" && f.options.length > 1,
    );
    if (gates.length > MAX_PROBES_PER_SECTION) {
      capture.warnings.push(
        `"${sectionName}" has ${gates.length} radio groups; probed only the first ${MAX_PROBES_PER_SECTION}.`,
      );
    }

    for (const gate of gates.slice(0, MAX_PROBES_PER_SECTION)) {
      const answers = await probeGate(gate, baseline);
      if (answers.some((a) => a.revealed.length)) {
        section.reveals.push({ gate: gate.key, gateLabel: gate.label, answers });
      }
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
      live.el.click();
      await sleep(NAV_SETTLE_MS);
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

  /** Coverage against the box numbers the backend map already knows. */
  function boxes() {
    const found = new Set();
    for (const s of capture.sections) {
      for (const f of s.fields) if (f.box) found.add(f.box);
      for (const r of s.reveals)
        for (const a of r.answers)
          for (const f of a.revealedFields || []) if (f.box) found.add(f.box);
    }
    return [...found].sort();
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

  window.__flagCapture = { run, save, capture, boxes, snapshot, findNavItems };
  console.log(
    "__flagCapture ready. Run: await __flagCapture.run() then __flagCapture.save()\n" +
      "Coverage check: __flagCapture.boxes()",
  );
})();
