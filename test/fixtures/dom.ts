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

// ── FLAG's masked money box (ETA-9035E F.10 from/to, F.11) ─────────────────
//
// The live contract, from Varis typing a wage into F.10 by hand on
// flag.dol.gov on 2026-10-26: the box takes "110344" and shows "$110,344.00".
// A dollar prefix, thousands separators, and exactly two decimal places, held
// on EVERY input event — which is what makes the character-by-character text
// path destroy the value rather than build it up.
//
// The real markup was not captured (the ETA-9035E dump records field names and
// kinds, not attributes), so what is reproduced here is the behaviour that was
// observed, which is the part the fill chain has to survive.

export interface CurrencyBoxHandle {
  input: HTMLInputElement;
  /** Every value the box was handed, before the mask rewrote it. */
  writes: string[];
}

export function mountCurrencyBox(name: string, opts: { disabled?: boolean } = {}): CurrencyBoxHandle {
  const el = document.createElement("input");
  el.type = "text";
  el.setAttribute("name", name);
  if (opts.disabled) el.disabled = true;
  document.body.appendChild(el);

  const handle: CurrencyBoxHandle = { input: el, writes: [] };
  let masking = false;
  el.addEventListener("input", () => {
    if (masking || el.disabled) return;
    const raw = el.value;
    handle.writes.push(raw);
    const digits = raw.replace(/[^0-9.]/g, "");
    let next = "";
    if (digits) {
      const [dollars, cents = ""] = digits.split(".");
      const whole = Number((dollars || "0").replace(/^0+(?=\d)/, ""));
      next = `$${whole.toLocaleString("en-US")}.${(cents + "00").slice(0, 2)}`;
    }
    masking = true;
    el.value = next;
    masking = false;
  });
  return handle;
}

// ── FLAG Section F: the worksite repeater (ETA-9035E) ──────────────────────
//
// The live contract, from Varis's screenshots of flag.dol.gov Section F on
// 2026-10-27. Below the worksite and wage boxes FLAG renders:
//
//   * a yellow banner — "If you navigate away from this page without clicking
//     the 'Add Place of Employment' button, your changes will be lost. Your
//     entry will be displayed in the table below.";
//   * an "Add Place of Employment" button, GREYED OUT while the entry fails
//     validation, with the failing boxes listed above it;
//   * a table headed "0 Entries for Place of Employment".
//
// So the section is a repeater whose rows are committed by their own button,
// and Continue saves a section with no rows unless that button was pressed.
// The real markup was not captured (the ETA-9035E dump records field names and
// kinds), so this reproduces the BEHAVIOUR, which is the part the walk needs.

export interface WorksiteRepeaterHandle {
  button: HTMLButtonElement;
  /** How many times the Add button was actually clicked. */
  clicks: number;
  rows: number;
  /** Grey the button out and show these validation messages, as FLAG does. */
  block(messages: string[]): void;
  /** Let the entry validate again. */
  unblock(): void;
}

export function mountWorksiteRepeater(
  opts: { rows?: number; errors?: string[]; commits?: boolean } = {},
): WorksiteRepeaterHandle {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    '<div class="usa-alert usa-alert--warning">If you navigate away from this page ' +
    "without clicking the 'Add Place of Employment' button, your changes will be " +
    "lost. Your entry will be displayed in the table below.</div>" +
    '<div id="mk-errors"></div>' +
    '<button type="button">Add Place of Employment</button>' +
    '<h3 id="mk-entries"></h3><table><tbody id="mk-rows"></tbody></table>';
  document.body.appendChild(wrap);

  const button = wrap.querySelector("button")!;
  const heading = wrap.querySelector<HTMLElement>("#mk-entries")!;
  const errorBox = wrap.querySelector<HTMLElement>("#mk-errors")!;
  const handle: WorksiteRepeaterHandle = {
    button,
    clicks: 0,
    rows: opts.rows ?? 0,
    block(messages) {
      button.disabled = true;
      errorBox.replaceChildren(
        ...messages.map((m) => {
          const div = document.createElement("div");
          div.className = "usa-error-message";
          div.textContent = m;
          return div;
        }),
      );
    },
    unblock() {
      button.disabled = false;
      errorBox.replaceChildren();
    },
  };

  const paint = (): void => {
    heading.textContent = `${handle.rows} Entries for Place of Employment`;
  };
  paint();
  if (opts.errors?.length) handle.block(opts.errors);

  button.addEventListener("click", () => {
    // A disabled button swallows the click on a real page; happy-dom does too,
    // but the count is asserted either way so the guard is explicit.
    if (button.disabled) return;
    handle.clicks += 1;
    if (opts.commits === false) return;
    handle.rows += 1;
    paint();
  });
  return handle;
}

// ── FLAG Section F: the OES Wage Calculator modal ──────────────────────────
//
// Reproduced from the H-1B extension's own field map and flow
// (paraleagle-ext, src/mappings/lca-field-map.ts `F_OES` block and
// src/content/lca-filler.ts `fillSectionF` steps 2-6), which drove this modal
// in production for years:
//
//   #OES_state, [name=OES_collection_type], [name=OES_area_based], #OES_area,
//   [name=OES_rd_flag]  ->  "Calculate"  ->  #OES_prevailing_wage fills, and
//   #OES_wage_level / #OES_per become enabled  ->  "Submit" applies the result
//   to the application and closes the modal.
//
// DOL has redesigned this modal once already (the old extension says so in a
// comment), so these ids may have aged — which is exactly why the driver has
// to degrade to a reported miss, and why that is what these fixtures exercise.

export interface OesCalculatorHandle {
  openButton: HTMLButtonElement;
  opens: number;
  calculates: number;
  submits: number;
  /** What the modal applied to the application, once Submit was pressed. */
  applied: Record<string, string> | null;
}

export function mountOesCalculator(
  opts: {
    /** Pressing the button opens nothing — a redesign we cannot drive. */
    neverOpens?: boolean;
    /** Calculate produces no wage — a combination DOL has no data for. */
    noResult?: boolean;
    /** The wage Calculate returns. */
    wage?: string;
    /** Field ids to leave OUT of the modal, as a redesign would. */
    omit?: string[];
    areaOptions?: string[];
    /**
     * The Area combobox as flag.dol.gov actually serves it, read off the live
     * modal on 2026-10-27:
     *
     *   * placeholder "Type search term here", with a dropdown chevron;
     *   * its option list PORTALLED to <body>, outside the dialog node, and
     *     linked to the input only by `aria-controls`;
     *   * list items that are plain `<li class="dropdown-item">` — no
     *     `role="option"`, nothing MUI-shaped;
     *   * "Calculate" greyed out until an Area has been COMMITTED (typing into
     *     the box is not enough);
     *   * "Submit" refused, and the dialog left open, while Area is empty.
     *
     * That last pair is the cascade: no Area means no wage, which means F.11,
     * F.11a, F.13a and F.13b stay empty and "Add Place of Employment" stays
     * grey, so the worksite row is never committed.
     */
    areaIsPortalled?: boolean;
  } = {},
): OesCalculatorHandle {
  const omit = new Set(opts.omit ?? []);
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.textContent = "OES Wage Calculator";
  document.body.appendChild(openButton);

  const handle: OesCalculatorHandle = {
    openButton,
    opens: 0,
    calculates: 0,
    submits: 0,
    applied: null,
  };

  const radios = (name: string, values: string[]): string =>
    values
      .map(
        (v, i) =>
          `<label for="${name}_${i}">${v}` +
          `<input type="radio" name="${name}" id="${name}_${i}" value="${escapeAttr(v)}" /></label>`,
      )
      .join("");

  const select = (id: string, values: string[], disabled: boolean): string =>
    `<select id="${id}"${disabled ? " disabled" : ""}>` +
    `<option value="">- Select -</option>` +
    values.map((v) => `<option value="${escapeAttr(v)}">${v}</option>`).join("") +
    "</select>";

  openButton.addEventListener("click", () => {
    if (opts.neverOpens || document.querySelector('[role="dialog"]')) return;
    handle.opens += 1;
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML =
      (omit.has("OES_state")
        ? ""
        : select("OES_state", ["CALIFORNIA", "TEXAS", "WASHINGTON"], false)) +
      radios("OES_collection_type", ["All Industries", "ACWIA Higher Ed."]) +
      radios("OES_area_based", ["County/Township", "BLS Areas"]) +
      `<input id="OES_area" role="combobox" />` +
      `<ul role="listbox" id="OES_area_list"></ul>` +
      radios("OES_rd_flag", ["No", "Yes"]) +
      select("OES_wage_level", ["I", "II", "III", "IV", "N/A"], true) +
      select("OES_per", ["Hour", "Week", "Bi-Weekly", "Month", "Year"], true) +
      `<input id="OES_prevailing_wage" value="$nnnn.nn" readonly />` +
      `<button type="button">Calculate</button>` +
      `<button type="button">Submit</button>`;
    document.body.appendChild(dialog);

    // The area combobox: filters its list as it is typed, commits on click.
    const area = dialog.querySelector<HTMLInputElement>("#OES_area")!;
    let list = dialog.querySelector<HTMLUListElement>("#OES_area_list")!;
    const portalled = opts.areaIsPortalled === true;
    if (portalled) {
      // FLAG's own shape: the list lives at <body> level, reachable from the
      // input only through ARIA, and its items carry no role="option".
      list.remove();
      list = document.createElement("ul");
      list.id = "OES_area_list";
      list.className = "dropdown-menu";
      document.body.appendChild(list);
      area.setAttribute("placeholder", "Type search term here");
      area.setAttribute("aria-controls", "OES_area_list");
    }
    const options = opts.areaOptions ?? ["Santa Clara County, CA", "Santa Cruz County, CA"];
    // Committed, not merely typed. FLAG keeps Calculate grey until an option
    // has been PICKED, so a box holding query text counts for nothing.
    let areaCommitted = "";
    area.addEventListener("input", () => {
      const query = area.value.toLowerCase();
      areaCommitted = "";
      list.replaceChildren();
      for (const label of options) {
        if (query && !label.toLowerCase().includes(query)) continue;
        const li = document.createElement("li");
        if (portalled) li.className = "dropdown-item";
        else li.setAttribute("role", "option");
        li.textContent = label;
        const take = (): void => {
          area.value = label;
          areaCommitted = label;
          area.dispatchEvent(new Event("change", { bubbles: true }));
          list.replaceChildren();
          if (portalled) calculateButton().disabled = false;
        };
        // A USWDS/FLAG list item commits on MOUSEDOWN, not on click.
        li.addEventListener(portalled ? "mousedown" : "click", take);
        list.appendChild(li);
      }
    });

    const calculateButton = (): HTMLButtonElement =>
      [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Calculate")!;
    if (portalled) calculateButton().disabled = true;

    const result = dialog.querySelector<HTMLInputElement>("#OES_prevailing_wage")!;
    const level = dialog.querySelector<HTMLSelectElement>("#OES_wage_level");
    const per = dialog.querySelector<HTMLSelectElement>("#OES_per");

    for (const button of dialog.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        if (button.textContent === "Calculate") {
          handle.calculates += 1;
          if (opts.noResult) return;
          result.value = opts.wage ?? "$61.52";
          // The level and the per only become answerable once there is a wage.
          if (level) level.disabled = false;
          if (per) per.disabled = false;
          return;
        }
        // FLAG will not take a Submit while a required box is empty: the
        // dialog stays up, with "This field is required" against Area.
        if (portalled && !areaCommitted) return;
        handle.submits += 1;
        handle.applied = {
          prevailing_wage: result.value,
          wage_level: level?.value ?? "",
          per: per?.value ?? "",
          area: areaCommitted || area.value,
        };
        list.remove();
        dialog.remove();
      });
    }
  });

  return handle;
}
