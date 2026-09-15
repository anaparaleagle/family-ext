/* eslint-disable no-console */
// PDF Intake page capture — paste into the DevTools console on a THROWAWAY
// my.uscis.gov/pdf-intake draft, then on each page run:
//
//     __capture.page("01-select-eligibility")
//
// It reads the page and downloads one JSON file in the same shape as
// test/fixtures/i765-online-field-dump/. It never clicks anything.
//
// When the walk is done: __capture.list()

(() => {
  const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  const questionFor = (input) => {
    let node = input.closest("fieldset, [role=radiogroup], .MuiFormControl-root");
    for (let i = 0; i < 4 && !node; i++) node = input.parentElement;
    const legend = node?.querySelector("legend, .MuiFormLabel-root");
    return legend ? text(legend) : "";
  };

  const labelFor = (input) => {
    if (input.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) return text(lbl);
    }
    const wrap = input.closest("label");
    if (wrap) return text(wrap);
    return input.getAttribute("aria-label") || "";
  };

  const readFields = () => {
    const seen = new Map();
    const out = [];
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "file" || el.type === "hidden" || el.type === "submit") return;
      const name = el.name || null;
      const entry = {
        name,
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        label: labelFor(el),
        required: el.required === true,
        value: el.value ?? "",
      };
      if (el.type === "radio" || el.type === "checkbox") {
        const key = `${name}::${el.type}`;
        if (seen.has(key)) {
          seen.get(key).options.push(entry.label || entry.value);
          return;
        }
        entry.options = [entry.label || entry.value];
        entry.question = questionFor(el);
        seen.set(key, entry);
      }
      if (el.tagName === "SELECT") {
        entry.options = [...el.options].map((o) => text(o));
      }
      out.push(entry);
    });
    return out;
  };

  const snapshot = () => ({
    url: location.href,
    heading: text(document.querySelector("h1")) || text(document.querySelector("h2")),
    headings_all: [...document.querySelectorAll("h1, h2, h3, legend")].map(text).filter(Boolean),
    question_texts: [...document.querySelectorAll("legend, .MuiFormLabel-root")]
      .map(text)
      .filter(Boolean),
    page_text_first_1200: text(document.body).slice(0, 1200),
    buttons: [...document.querySelectorAll("button, [role=button]")].map((b) => ({
      text: text(b),
      id: b.id || null,
      testid: b.getAttribute("data-testid"),
    })),
    file_inputs: [...document.querySelectorAll("input[type=file]")].map((f) => ({
      id: f.id || null,
      name: f.name || null,
      accept: f.accept || null,
      multiple: f.multiple === true,
    })),
    fields: readFields(),
  });

  const saved = [];

  const download = (name, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  window.__capture = {
    page(name) {
      if (!name) return console.error('Give the page a name, e.g. __capture.page("01-select-eligibility")');
      const data = snapshot();
      download(name, data);
      saved.push({ name, url: data.url, fields: data.fields.length, uploads: data.file_inputs.length });
      console.log(
        `saved ${name}.json — ${data.fields.length} field(s), ${data.file_inputs.length} upload slot(s)`,
        `\n  heading: ${data.heading}`,
        `\n  path:    ${new URL(data.url).pathname}`,
      );
      return data;
    },
    peek: () => snapshot(),
    list: () => console.table(saved),
  };

  console.log('PDF Intake capture ready. On each page run: __capture.page("01-name-of-page")');
})();
