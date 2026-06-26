// Minimal mock myUSCIS DOM builders for tests. Uses the REAL Formik [name]
// attributes captured in i130-online-field-dump.json so the value-setter and
// fill-chain are exercised against the actual field-name shapes.
//
// NOTE: happy-dom has no React fiber, so the Formik bridge path is inert here
// (setViaFormik reads back no "ok" ack). That is intentional — these tests
// cover the NON-bridge strategies (execCommand / native setter / clicks) and
// the page-walk/descriptor logic. The bridge is verified live via agent-browser.

export function setBody(html: string): void {
  document.body.innerHTML = html;
}

/** A plain text input with a Formik name + matching id (myUSCIS pattern). */
export function textInput(name: string, id = name): string {
  return `<input type="text" name="${name}" id="${escapeAttr(id)}" />`;
}

/** A two-option radio group (e.g. true/false, or coded options). */
export function radioGroup(name: string, options: Array<{ value: string; label: string }>): string {
  return options
    .map(
      (o, i) =>
        `<label for="${escapeAttr(name)}_${i}">${o.label}` +
        `<input type="radio" name="${name}" id="${escapeAttr(name)}_${i}" value="${o.value}" /></label>`,
    )
    .join("");
}

export function checkbox(name: string): string {
  return `<input type="checkbox" name="${name}" id="${escapeAttr(name)}" />`;
}

export function select(name: string, options: Array<{ value: string; label: string }>): string {
  const opts = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  return `<select name="${name}" id="${escapeAttr(name)}">${opts}</select>`;
}

/** A page heading + Next button, to exercise navigation/detection. */
export function pageChrome(heading: string): string {
  return `<h1>${heading}</h1><button data-testid="next-button">Next</button>`;
}

/** A repeater "Add" button. */
export function addButton(label: string): string {
  return `<button type="button">${label}</button>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
