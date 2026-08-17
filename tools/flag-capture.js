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

  /**
   * Evidence for which box a RADIO GROUP is, gathered instead of guessed.
   *
   * A FLAG radio's own label is its option text ("Yes"), and the enclosing
   * fieldset spans several questions — so run 2 assigned NO box number to 29 of
   * 31 radios, and on the two it did assign it put both `jobOppPWDAttached` and
   * `jobOppWagePer` on E.3, which cannot both be right.
   *
   * Rather than a cleverer heuristic — the same class of silent mis-assignment
   * that has now bitten this table twice — capture the surrounding text and
   * every box number in it, and let a person assign 31 fields by hand against
   * the backend map's own labels. The evidence travels with the capture, so the
   * assignment is reviewable instead of asserted.
   */
  function questionEvidence(el) {
    const group =
      el.closest("fieldset, .form-group, [class*='question'], [class*='Question']") ||
      el.parentElement;
    const text = norm(group?.textContent).slice(0, 400);
    const boxes = [];
    for (const m of text.matchAll(
      /(?:APX\s*)?[A-Z](?:\.[a-zA-Z])?\.\d+(?:\.?[a-z])?\./g,
    )) {
      const box = m[0].replace(/\.$/, "").replace(/\s+/g, "");
      if (!boxes.includes(box)) boxes.push(box);
    }
    return { context: text, boxCandidates: boxes };
  }

  /**
   * Ours, not FLAG's.
   *
   * Run 2 recorded `mk-autofill-section` as a field in every single section: it
   * is a <select> the H-1B extension injects into the page. Capturing your own
   * extension's DOM as if it were the form's is how a descriptor ends up
   * driving a control the government never rendered.
   */
  function isOurs(el) {
    return /^mk-|paraleagle/i.test(el.id || "") || /^mk-|paraleagle/i.test(el.name || "");
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
      if (!visible(el) || isOurs(el)) continue;
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
            ...questionEvidence(el),
          });
        }
        const group = radioGroups.get(groupName);
        group.options.push({ value: el.value, label, id: el.id || null });
        if (el.checked) group.checked = el.value;
        // The per-option label is all a radio's own label ever gives, so the
        // group keeps the FIRST option's text only for logging. Which box this
        // group IS comes from `boxCandidates` and a human — see questionEvidence.
        if (!group.label) group.label = label;
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
  async function probeGate(gate, sectionName) {
    const results = [];
    const original = gate.kind === "select" ? gate.current : gate.checked;

    for (const opt of answersFor(gate)) {
      if (FORBIDDEN.test(opt.label)) continue;

      // A FRESH baseline per answer, not one per section.
      //
      // Run 2 diffed every gate against a baseline taken at the top of the
      // section, and reported that five different F.b/c gates each revealed
      // `otherEducation` and `major` on BOTH Yes and No — identical results for
      // opposite answers, which is not a reveal, it is contamination. What had
      // happened: `primaryEducationLevel` was probed first, finished on its last
      // option, and could not be put back because the draft had never answered
      // it — so those two fields stayed rendered and every later gate "revealed"
      // them. Diffing against the state immediately before THIS answer makes the
      // result correct whether or not the restore worked.
      const before = snapshot(sectionName);
      if (!answer(gate, opt.value)) continue;
      await sleep(SETTLE_MS);

      const after = snapshot(sectionName);
      const revealed = [...after.keys()].filter((k) => !before.has(k));
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

  // ── repeaters ────────────────────────────────────────────────────────────
  //
  // WHAT RUN 2 GOT WRONG. It assumed the ~100 unreached boxes were behind Yes/No
  // reveals. They are not. Run 2 walked every section and found F.b Additional
  // Worksites, H.c Recruitment Information and Appendix A.B Foreign Worker
  // Education each holding ZERO inputs — not hidden ones, none at all. Those
  // sections are REPEATERS: the fields do not exist until a row is added, so no
  // amount of answering radios will ever surface them.
  //
  // Hence this pass. It clicks each "Add ..." control once and captures what
  // appears, which is the row shape a descriptor needs.

  /** Visible clickable controls, so a section records where its Add buttons are. */
  function buttonsOnScreen() {
    const out = [];
    for (const el of document.querySelectorAll(
      "button, [role='button'], a.btn, input[type='button']",
    )) {
      if (!visible(el) || isOurs(el)) continue;
      const text = norm(el.textContent || el.value);
      if (text && !out.includes(text)) out.push(text);
    }
    return out;
  }

  /**
   * Click every "Add ..." control once and record the row it renders.
   *
   * ONLY "Add". Never Save, Next or Continue: those commit and navigate, which
   * would end the walk mid-section and leave the rest of the form uncaptured.
   * Once each, because a second click adds a second row and rows on FLAG cannot
   * always be removed — this is a mutation on a throwaway draft either way,
   * which is why the file says to use one.
   */
  async function probeRepeaters(sectionName) {
    const rows = [];
    const addButtons = [...document.querySelectorAll("button, [role='button']")].filter(
      (el) => visible(el) && !isOurs(el) && /^add\b/i.test(norm(el.textContent)),
    );

    for (const btn of addButtons) {
      const text = norm(btn.textContent);
      if (FORBIDDEN.test(text)) continue;
      const before = snapshot(sectionName);
      btn.click();
      await sleep(NAV_SETTLE_MS);
      const after = snapshot(sectionName);
      const added = [...after.keys()].filter((k) => !before.has(k));
      rows.push({
        addButtonText: text,
        added,
        addedFields: added.map((k) => after.get(k)),
        // A modal is a different fill strategy from an inline row — it needs its
        // own commit click — so which one this is must be recorded, not inferred
        // later from field names.
        inModal: !!document.querySelector(
          "[role='dialog']:not([aria-hidden='true']), .modal.show",
        ),
      });
      console.log(`      "${text}" -> +${added.length} field(s)`, added);
    }
    return rows;
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
      // Where the Add controls are. Run 2 did not capture these and so could not
      // explain why three sections held zero inputs.
      buttons: buttonsOnScreen(),
      reveals: [],
      rows: [],
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
      const answers = await probeGate(gate, sectionName);
      if (answers.some((a) => a.revealed.length)) {
        section.reveals.push({ gate: gate.key, gateLabel: gate.label, answers });
      }
    }

    // Repeaters LAST, so the Add pass runs against a section whose gates have
    // been answered — on the 9089 the recruitment and appendix rows may not
    // offer an Add control at all until the occupation type upstream is set.
    section.rows = await probeRepeaters(sectionName);

    // How far the page moved overall. No longer a correctness problem — each
    // answer is diffed against the state just before it (see probeGate) — but
    // still worth recording: it is how much junk this run left in the draft, and
    // it is why the draft must be a throwaway.
    const drift = [...snapshot(sectionName).keys()].filter((k) => !baseline.has(k));
    if (drift.length) {
      section.leftBehind = drift;
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
      // RUN 2 SKIPPED EIGHT REAL SECTIONS HERE. The old rule was "same field set
      // before and after => not a section link", which is true for the global
      // Cases / Profiles / My Network links but catastrophically wrong for a
      // section that legitimately renders NO inputs: F.c Other Definable
      // Geographic Areas, H.d, H.e, Appendices A.C, A.D, A.E, B and C all
      // compared equal because both sides were empty, and all eight were dropped
      // from the capture entirely rather than recorded as empty. An absent
      // section reads as "not looked at"; an empty one is a finding.
      //
      // So the fingerprint now includes the page's own heading text, and a
      // no-change result records the section as empty instead of discarding it.
      const fingerprint = () =>
        [...snapshot(item.text).keys()].join("|") +
        "##" +
        norm(document.querySelector("h1, h2, legend")?.textContent).slice(0, 80);
      const before = fingerprint();
      live.el.click();
      await sleep(NAV_SETTLE_MS);
      const unchanged = fingerprint() === before && capture.sections.length > 0;

      const section = await captureSection(item.text);
      section.navChanged = !unchanged;
      if (unchanged && !section.fields.length) {
        // Genuinely nothing here. Worth one line rather than a whole section.
        capture.warnings.push(
          `"${item.text}" rendered no inputs and no Add control — either not a ` +
            `section link, or a section that stays empty until an upstream answer ` +
            `opens it. Recorded as empty.`,
        );
      }
      capture.sections.push(section);
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
      for (const row of s.rows || [])
        for (const f of row.addedFields || []) seen.set(`${s.name}|${f.key}`, f);
    }
    return [...seen.values()];
  }

  /**
   * Did this run actually improve on the last one? Print before saving.
   *
   * The two numbers that decide it:
   *
   *   rowFields — fields that only exist after an Add click. This is what run 2
   *     missed entirely, and where most of the ~100 unreached boxes live. Run 2
   *     scored 0 because it never clicked Add.
   *   radiosWithBoxCandidates — a radio whose surrounding text contains at least
   *     one box number, i.e. one that CAN be hand-assigned to a map entry. Run 2
   *     could not assign 29 of 31 radios at all.
   *   emptySections — sections that render nothing. A finding, not a failure:
   *     it says "this section is a repeater or is gated further upstream".
   */
  function coverage() {
    const fields = allFields();
    const radios = fields.filter((f) => f.kind === "radio");
    const rowFields = capture.sections.flatMap((s) =>
      (s.rows || []).flatMap((r) => r.addedFields || []),
    );
    const report = {
      sections: capture.sections.length,
      emptySections: capture.sections.filter((s) => !s.fields.length).length,
      fields: fields.length,
      withMapId: fields.filter((f) => f.mapId).length,
      rowFields: rowFields.length,
      addButtons: capture.sections.reduce((n, s) => n + (s.rows || []).length, 0),
      radios: radios.length,
      radiosWithOptionValues: radios.filter((f) =>
        (f.options || []).some((o) => o.value),
      ).length,
      radiosWithBoxCandidates: radios.filter((f) => (f.boxCandidates || []).length).length,
      // No name, no id — the SOC/NAICS comboboxes. These need a hand-written
      // locate strategy in the descriptor, so knowing the count is knowing how
      // much hand work is left.
      unaddressable: fields.filter((f) => f.key.startsWith("combobox@")).length,
      warnings: capture.warnings.length,
    };
    console.table([report]);
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
