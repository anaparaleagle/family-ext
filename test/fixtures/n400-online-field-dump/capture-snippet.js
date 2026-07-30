// N-400 ONLINE CAPTURE SNIPPET — paste into the DevTools console on any page of
// the myUSCIS online N-400 draft, press Enter, then paste the result back.
//
// It copies the result to your clipboard automatically (DevTools `copy()`), so
// you do NOT have to select the output.
//
// What it captures, per page:
//   - url / slug / heading            -> the page identity for the descriptor
//   - sidebar: every section link + href -> EVERY page slug of the form at once
//   - fields: name, label, type, required, options -> the raw material for both
//     the backend value map and the structural descriptor
//
// WHY the sidebar selector is `.MuiAccordion-root a` and not `nav, aside`:
// the form section sidebar is MUI accordions. A generic nav selector grabs the
// ACCOUNT nav instead and returns junk (learned the hard way on the I-539,
// 2026-07-15). There is also no <main> element on these pages.
//
// Slug CASE MATTERS. The I-539 has /evidence/form-I-20 with a capital I while
// every neighbouring slug is lower-case, and page matching is a case-sensitive
// path compare — so a helpfully-lowercased slug silently matches nothing.
// This snippet reports hrefs verbatim. Do not "tidy" them.

(() => {
  const txt = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : "");

  // Visible question text for an input. Tried in order of reliability: the
  // explicit aria label, the label element bound by id, then the enclosing MUI
  // form control's label/legend (which is where radio-group questions live).
  const labelFor = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const lid = el.getAttribute("aria-labelledby");
    if (lid) {
      const parts = lid
        .split(/\s+/)
        .map((id) => txt(document.getElementById(id)))
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    if (el.id) {
      const bound = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (bound) return txt(bound);
    }
    const group = el.closest(".MuiFormControl-root, fieldset, .MuiFormGroup-root");
    if (group) {
      const l = group.querySelector("legend, label");
      if (l) return txt(l);
    }
    return "";
  };

  const nodes = [...document.querySelectorAll("input, textarea, select")].filter(
    (el) => el.name || el.id,
  );

  // Radios sharing a name are ONE field with N options — collapse them, and keep
  // every option value, because the descriptor records the real option codes.
  const radioOptions = {};
  for (const el of nodes) {
    if (el.type !== "radio" || !el.name) continue;
    (radioOptions[el.name] ||= []).push(el.value);
  }

  const seenRadio = new Set();
  const fields = [];
  for (const el of nodes) {
    if (el.type === "radio") {
      if (seenRadio.has(el.name)) continue;
      seenRadio.add(el.name);
    }
    const f = {
      name: el.name || null,
      id: el.id || null,
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      label: labelFor(el),
      required: el.required || el.getAttribute("aria-required") === "true",
      // A value already present tells us whether the page was pre-filled, which
      // matters when judging whether OUR fill actually wrote anything.
      value: (el.value || "").slice(0, 40),
    };
    if (el.type === "radio") f.options = radioOptions[el.name];
    if (el.tagName === "SELECT") f.options = [...el.options].map((o) => o.value);
    // MUI Autocompletes render as plain text inputs but MUST be driven as
    // "search" (type the display text, pick from the listbox). This is the only
    // hint available in a static dump, so record it.
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete"))
      f.autocomplete = true;
    fields.push(f);
  }

  const out = {
    url: location.href,
    slug: location.pathname.replace(/^.*?\/\d+/, ""),
    heading: txt(document.querySelector("h1, h2")),
    sidebar: [...document.querySelectorAll(".MuiAccordion-root a")].map((a) => ({
      text: txt(a),
      href: a.getAttribute("href"),
    })),
    // Advance controls, so the walk knows what to click — and so a review/submit
    // page is recognisable BEFORE anything clicks Next on it.
    buttons: [...document.querySelectorAll("button")]
      .map((b) => ({ text: txt(b), id: b.id || null, testid: b.getAttribute("data-testid") }))
      .filter((b) => b.text),
    fieldCount: fields.length,
    fields,
  };

  const json = JSON.stringify(out, null, 1);
  try {
    copy(json); // DevTools-only helper; puts the whole dump on the clipboard
    console.log(`N-400 dump: ${fields.length} fields, ${out.sidebar.length} sidebar links — COPIED to clipboard`);
  } catch {
    console.log("copy() unavailable — select the output below manually");
  }
  return json;
})();
