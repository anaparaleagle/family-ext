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

// ── MUI Select (the pdf-intake I-765 eligibility control) ───────────────────
//
// NOT an autocomplete. The live accessibility tree showed TWO elements: a
// div[role="combobox"] bearing the current option's display text, and a HIDDEN
// native input (class MuiSelect-nativeInput) carrying the `name` and the
// committed CODE ("C9"/"A12"). Typing does nothing — the popup only opens on
// MOUSEDOWN, does not filter, and renders its [role="option"] items in a portal
// on document.body. This fixture reproduces exactly that contract.

export interface MuiSelectHandle {
  /** The hidden native input — the name carrier and the commit ground truth. */
  input: HTMLInputElement;
  /** The display element the popup opens from. */
  combobox: HTMLElement;
  /** How many times the popup was opened (mousedown reached the combobox). */
  opens: number;
}

export function mountMuiSelect(opts: {
  name: string;
  options: Array<{ value: string; label: string }>;
  /** What the control already holds (code + display text). */
  committed?: { value: string; label: string };
  /** false simulates a commit React swallowed: the click closes the popup but
   * the hidden input keeps its old value. */
  commitOnClick?: boolean;
  /** Swallow the commit for this many opening clicks, then behave normally —
   * a popup that was still settling when the first pick landed. */
  swallowClicks?: number;
  /** Delay before the hidden input reflects the click — a slow React commit. */
  commitDelayMs?: number;
  /** Called once a commit lands (to simulate revealed blocks re-rendering). */
  onCommit?: (value: string) => void;
}): MuiSelectHandle {
  const wrap = document.createElement("div");
  wrap.className = "MuiFormControl-root";
  wrap.innerHTML =
    `<div class="MuiInputBase-root MuiOutlinedInput-root">` +
    `<div role="combobox" aria-haspopup="listbox" aria-expanded="false" class="MuiSelect-select">${
      opts.committed?.label ?? ""
    }</div>` +
    `<input aria-hidden="true" tabindex="-1" class="MuiSelect-nativeInput" ` +
    `name="${escapeAttr(opts.name)}" value="${escapeAttr(opts.committed?.value ?? "")}" />` +
    `</div>`;
  document.body.appendChild(wrap);
  const combobox = wrap.querySelector<HTMLElement>('[role="combobox"]')!;
  const input = wrap.querySelector<HTMLInputElement>("input")!;
  const handle: MuiSelectHandle = { input, combobox, opens: 0 };

  let portal: HTMLElement | null = null;
  let swallowed = 0;
  const closePopup = (): void => {
    portal?.remove();
    portal = null;
    combobox.setAttribute("aria-expanded", "false");
  };
  const openPopup = (): void => {
    if (portal) return;
    handle.opens += 1;
    portal = document.createElement("div");
    portal.setAttribute("role", "presentation");
    portal.className = "MuiPopover-root MuiMenu-root";
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    for (const o of opts.options) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("data-value", o.value);
      li.textContent = o.label;
      li.addEventListener("click", () => {
        closePopup();
        if (opts.commitOnClick === false) return;
        if (swallowed < (opts.swallowClicks ?? 0)) {
          swallowed += 1;
          return;
        }
        const commit = (): void => {
          input.value = o.value;
          combobox.textContent = o.label;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          opts.onCommit?.(o.value);
        };
        if (opts.commitDelayMs) setTimeout(commit, opts.commitDelayMs);
        else commit();
      });
      ul.appendChild(li);
    }
    portal.appendChild(ul);
    document.body.appendChild(portal);
    combobox.setAttribute("aria-expanded", "true");
  };
  // MUI Select opens on MOUSEDOWN. A click() alone — and any amount of typing
  // into the hidden input — must do nothing, which is the live behaviour that
  // broke the type-to-filter path.
  combobox.addEventListener("mousedown", openPopup);
  return handle;
}
