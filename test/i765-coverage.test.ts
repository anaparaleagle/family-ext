// Cross-check the I-765 PDF-INTAKE descriptor against the LIVE FIELD DUMP
// (test/fixtures/i765-online-field-dump/, captured 2026-09-11). The I-765
// analogue of i539-coverage.test.ts — with one structural difference that
// changes how coverage must be asserted:
//
// PDF Intake is NOT a Formik guided form. Its field names are generic MUI
// defaults, and they COLLIDE across pages: `controlled-radio-buttons-group`
// names the I-485-fee gate on /select-eligibility AND the can-you-pay radio on
// /able-to-pay — two different questions. So the descriptor gives those radios
// SYNTHETIC payload names (the keys the backend map is being built against) and
// anchors each to its QUESTION TEXT via `locate.labelContains`. Coverage here
// therefore accounts a dump field either by exact name OR by question anchor,
// always within the page the dump captured it on.
//
//   every fillable field pdf-intake actually renders is either
//     (a) in I765_PAGES — we drive it (by name or by question anchor), or
//     (b) in I765_SKIP  — we deliberately leave it to the user, on the record.
//
// Nothing may fall between the two.

import { beforeEach, describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
  I765_PAGES,
  I765_SKIP,
  I765_ELIGIBILITY_OPTION_LABELS,
} from "../src/i765/form-descriptor";
import {
  FORM_CONFIGS,
  I765_CONFIG,
  configForFormType,
  configForPath,
  formTypeForCaseType,
} from "../src/runner/registry";
import { pageForUrl } from "../src/runner/section-detector";
import { fieldNamesOf, FormPage } from "../src/runner/types";
import { fillPage, findNextButton, onTerminalPath, planPageFill } from "../src/runner/fill-chain";
import { descriptorsForPage } from "../src/runner/doc-flow";
import { locateElement, setValue } from "../src/engine/value-setter";
import { mountMuiSelect, setBody } from "./fixtures/dom";

const DUMP_DIR = resolve(__dirname, "fixtures/i765-online-field-dump");
/** The 12 C9 page dumps, in walk order (01-select-eligibility … 12-review). */
const PAGE_DUMPS = readdirSync(DUMP_DIR)
  .filter((f) => /^\d{2}-.*\.json$/.test(f))
  .sort();
/** The A12/TPS branch capture of /select-eligibility — same page, other category. */
const A12_BRANCH = "branch-a12-select-eligibility.json";

/** The draft base every captured URL lives under. */
const LIVE_BASE = "https://my.uscis.gov/pdf-intake/I-765/d26a43cc-0f10-301e-86d3-a5ef2a773b85";

interface DumpField {
  name: string | null;
  tag: string;
  type: string;
  /** The question text a radio group sits under — the ONLY stable anchor for
   * the colliding generic names. Captured per-field in the dumps. */
  question?: string;
  options?: string[];
}

interface Dump {
  url: string;
  heading: string;
  fields?: DumpField[];
  file_inputs?: { accept: string }[];
}

function readDump(file: string): Dump {
  return JSON.parse(readFileSync(resolve(DUMP_DIR, file), "utf-8"));
}

/** What kind the descriptor page for this dump must be, derived from the dump
 * itself: typed fields => form (03-able-to-pay has BOTH a radio and the inline
 * I-912 file input, and it is a form page), else review by URL, else upload. */
function expectedKind(dump: Dump): FormPage["kind"] {
  if ((dump.fields ?? []).some((f) => f.name && f.type !== "file")) return "form";
  if (new URL(dump.url).pathname.endsWith("/review")) return "review";
  return "upload";
}

/** True when `page` accounts for the dump field: exact name, or a question
 * anchor (a `locate.labelContains` the captured question text contains). */
function pageAccountsFor(page: FormPage, field: DumpField): boolean {
  return page.fields.some((f) => {
    if (f.name === field.name) return true;
    const anchor = f.locate?.labelContains;
    if (!anchor || !field.question) return false;
    return field.question.toLowerCase().includes(anchor.toLowerCase());
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("I-765 descriptor <-> live pdf-intake dump", () => {
  const skipped = new Set(I765_SKIP);

  it("resolves every captured page URL to exactly its own descriptor page", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      const page = pageForUrl(I765_PAGES, dump.url);
      expect(page, `${file}: no descriptor page for ${dump.url}`).not.toBeNull();
      expect(
        new URL(dump.url).pathname.endsWith(page!.slug),
        `${file}: ${dump.url} resolved to the WRONG page ${page!.slug}`,
      ).toBe(true);
    }
  });

  it("declares the right kind for every captured page", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      const page = pageForUrl(I765_PAGES, dump.url)!;
      expect(page.kind, `${file} (${page.slug})`).toBe(expectedKind(dump));
    }
  });

  it("accounts for every fillable field in the capture (driven or skipped), per page", () => {
    for (const file of [...PAGE_DUMPS, A12_BRANCH]) {
      const dump = readDump(file);
      const page = pageForUrl(I765_PAGES, dump.url)!;
      const unaccounted = (dump.fields ?? [])
        .filter((f) => f.name && f.type !== "file")
        .filter((f) => !pageAccountsFor(page, f) && !skipped.has(f.name!));
      expect(
        unaccounted.map((f) => f.name),
        `${file}: dump fields neither driven nor skipped`,
      ).toEqual([]);
    }
  });

  it("never drives the colliding MUI default radio name literally", () => {
    // `controlled-radio-buttons-group` names DIFFERENT questions on
    // /select-eligibility and /able-to-pay. A descriptor entry carrying that
    // literal name would answer whichever group the engine found first.
    const driven = fieldNamesOf(I765_PAGES);
    expect(driven).not.toContain("controlled-radio-buttons-group");
  });

  it("anchors each colliding radio to the exact question text the capture shows", () => {
    const cases: Array<{ file: string; syntheticName: string }> = [
      { file: "01-select-eligibility.json", syntheticName: "select-eligibility.i485-fee-post-20240401" },
      { file: "03-able-to-pay.json", syntheticName: "able-to-pay.can-pay-fee" },
    ];
    for (const { file, syntheticName } of cases) {
      const dump = readDump(file);
      const page = pageForUrl(I765_PAGES, dump.url)!;
      const field = page.fields.find((f) => f.name === syntheticName);
      expect(field, `${page.slug}: missing synthetic field ${syntheticName}`).toBeDefined();
      expect(field!.kind).toBe("radio");
      expect(field!.options).toEqual(["Yes", "No"]);
      const question = dump.fields!.find((f) => f.name === "controlled-radio-buttons-group")!.question!;
      expect(field!.locate?.labelContains, `${syntheticName} needs a question anchor`).toBeTruthy();
      expect(question.toLowerCase()).toContain(field!.locate!.labelContains!.toLowerCase());
    }
  });

  it("never both drives and skips the same field", () => {
    const driven = new Set(fieldNamesOf(I765_PAGES));
    const both = [...skipped].filter((n) => driven.has(n));
    expect(both).toEqual([]);
  });

  it("skips nothing that pdf-intake does not actually render", () => {
    const captured = new Set<string>();
    for (const file of [...PAGE_DUMPS, A12_BRANCH]) {
      for (const f of readDump(file).fields ?? []) if (f.name) captured.add(f.name);
    }
    const phantom = I765_SKIP.filter((n) => !captured.has(n));
    expect(phantom, `skip entries not present in any capture: ${phantom.join(", ")}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-765 descriptor shape", () => {
  it("has unique slugs", () => {
    const slugs = I765_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("declares the three typed pages with the captured names", () => {
    const forms = I765_PAGES.filter((p) => p.kind === "form");
    expect(forms.map((p) => p.slug)).toEqual([
      "/select-eligibility",
      "/client-information/0",
      "/able-to-pay",
    ]);
    const client = forms[1];
    expect(client.fields.map((f) => f.name)).toEqual(["firstName", "middleName", "lastName"]);
    expect(client.fields.every((f) => f.kind === "text")).toBe(true);
  });

  it("declares every upload page with the EXACT page_path the backend emits, in walk order", () => {
    // These strings are the contract with the backend's upload_pages — the
    // evidence slugs carry a `/I-765/evidence` SUFFIX (read off the live URLs),
    // not a prefix. Do not "normalize" them.
    const uploads = I765_PAGES.filter((p) => p.kind === "upload");
    expect(uploads.map((p) => p.slug)).toEqual([
      "/form",
      "/form-g28",
      "/applicant-photo/I-765/evidence",
      "/form-i-94-passport/I-765/evidence",
      "/employment/I-765/evidence",
      "/form-i-485/I-765/evidence",
      "/form-i-797c/I-765/evidence",
      "/additional-evidence/I-765/evidence",
    ]);
    for (const p of uploads) expect(p.fields.length, p.slug).toBe(0);
  });

  it("terminates on the captured review page, which is last and fills nothing", () => {
    const reviews = I765_PAGES.filter((p) => p.kind === "review");
    expect(reviews.map((p) => p.slug)).toEqual(["/review"]);
    expect(reviews[0].fields).toEqual([]);
    // It must be LAST: fillAll breaks on kind === "review", so any page after it
    // would be silently unreachable.
    expect(I765_PAGES[I765_PAGES.length - 1].kind).toBe("review");
  });

  it("drives the eligibility picker as an autocomplete with the code -> label map", () => {
    // The backend emits the committed CODE ("C9"); the MUI autocomplete filters
    // on the full option LABEL, so typing the raw code renders zero options.
    // The descriptor owns that translation via valueMap.
    const options = JSON.parse(
      readFileSync(resolve(DUMP_DIR, "eligibility-options.json"), "utf-8"),
    ).options as string[];
    const c9Label = options.find((o) => o.startsWith("(c)(9)"))!;
    const a12Label = options.find((o) => o.startsWith("(a)(12)"))!;
    const elig = I765_PAGES.flatMap((p) => p.fields).find((f) => f.name === "eligibility-choice")!;
    expect(elig.kind).toBe("search");
    expect(elig.valueMap?.C9).toBe(c9Label);
    expect(elig.valueMap?.A12).toBe(a12Label);
    expect(I765_ELIGIBILITY_OPTION_LABELS.C9).toBe(c9Label);
  });

  it("declares the reason radio with the captured option labels", () => {
    const reason = I765_PAGES.flatMap((p) => p.fields).find(
      (f) => f.name === "reason-for-filing-radio-group",
    )!;
    expect(reason.kind).toBe("radio");
    expect(reason.options).toEqual(["Initial", "Replacement", "Renewal"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The payload-key convention the backend map is being built against. These keys
// are load-bearing on BOTH sides at once — pin them here so neither drifts.

const CONVENTION_PAYLOAD: Record<string, string> = {
  "eligibility-choice": "C9",
  "reason-for-filing-radio-group": "Initial",
  "select-eligibility.i485-fee-post-20240401": "Yes",
  firstName: "Valli",
  middleName: "",
  lastName: "Reddy",
  "able-to-pay.can-pay-fee": "No",
};

describe("I-765 payload convention -> fill plan", () => {
  const selectEligibility = () => I765_PAGES.find((p) => p.slug === "/select-eligibility")!;

  it("translates the eligibility code through valueMap before driving", () => {
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    const elig = plan.find((p) => p.spec.name === "eligibility-choice");
    expect(elig, "eligibility-choice missing from the plan").toBeDefined();
    expect(elig!.value).toBe(
      "(c)(9) Certain Family and Employment Based Adjustment Applicant Under Section 245",
    );
  });

  it("carries the raw payload code as commitValue, so the engine can verify the hidden input", () => {
    // The LIVE control turned out to be a MUI Select: the named input is hidden
    // and commits the CODE ("C9"), while the option is clicked by LABEL. The
    // label is what the engine drives with (valueMap), but the code is the only
    // ground truth of commitment — so the plan must carry both.
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    const elig = plan.find((p) => p.spec.name === "eligibility-choice")!;
    expect(elig.spec.commitValue).toBe("C9");
    // Fields with no valueMap must NOT grow a commitValue — their typed value
    // already is what the input holds.
    const client = I765_PAGES.find((p) => p.slug === "/client-information/0")!;
    for (const p of planPageFill(client, CONVENTION_PAYLOAD)) {
      expect(p.spec.commitValue, p.spec.name).toBeUndefined();
    }
  });

  it("drives the eligibility picker FIRST — the radios only exist once a category is chosen", () => {
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    expect(plan.map((p) => p.spec.name)).toEqual([
      "eligibility-choice",
      "reason-for-filing-radio-group",
      "select-eligibility.i485-fee-post-20240401",
    ]);
  });

  it("drops the page-1 radios when the payload never chose a category", () => {
    // Without an eligibility answer pdf-intake shows neither radio, so
    // attempting them would report failures for fields that cannot exist.
    const plan = planPageFill(selectEligibility(), {
      "reason-for-filing-radio-group": "Initial",
      "select-eligibility.i485-fee-post-20240401": "Yes",
    });
    expect(plan).toEqual([]);
  });

  it("plans every client-information and able-to-pay value it is sent", () => {
    const client = I765_PAGES.find((p) => p.slug === "/client-information/0")!;
    expect(planPageFill(client, CONVENTION_PAYLOAD).map((p) => p.spec.name)).toEqual([
      "firstName",
      "lastName", // middleName is "" -> legitimately omitted
    ]);
    const pay = I765_PAGES.find((p) => p.slug === "/able-to-pay")!;
    const payPlan = planPageFill(pay, CONVENTION_PAYLOAD);
    expect(payPlan.map((p) => p.spec.name)).toEqual(["able-to-pay.can-pay-fee"]);
    expect(payPlan[0].value).toBe("No");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-765 registry entry", () => {
  it("declares the pdf-intake host path and the IR case types", () => {
    expect(I765_CONFIG.formType).toBe("I-765");
    expect(I765_CONFIG.hostPath).toBe("/pdf-intake/I-765/");
    expect(I765_CONFIG.pages).toBe(I765_PAGES);
    expect(I765_CONFIG.caseTypes).toEqual(["IR-1", "IR-2", "IR-5"]);
    expect(FORM_CONFIGS).toContain(I765_CONFIG);
  });

  it("routes a live pdf-intake URL to the I-765 config", () => {
    const c = configForPath(new URL(`${LIVE_BASE}/select-eligibility`).pathname);
    expect(c?.formType).toBe("I-765");
    const evidence = configForPath(
      new URL(`${LIVE_BASE}/applicant-photo/I-765/evidence`).pathname,
    );
    expect(evidence?.formType).toBe("I-765");
  });

  it("looks the config up by backend form_type", () => {
    expect(configForFormType("I-765")).toBe(I765_CONFIG);
  });

  it("keeps the case-type auto-switch on the I-130 for the shared IR types", () => {
    // The IR case types file BOTH an I-130 and (once the I-485 is pending) this
    // C9 I-765. formTypeForCaseType reads the FIRST match, and the I-130 is
    // deliberately first: the petition is the default thing to fill for an IR
    // case, and swapping the picker to I-765 under a caseworker who loaded the
    // case for the petition would be worse. Picking I-765 stays a manual choice.
    for (const code of ["IR-1", "IR-2", "IR-5"]) {
      expect(formTypeForCaseType(code)).toBe("I-130");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-765 terminal guard", () => {
  it("stops on the pdf-intake /review page (Next self-enables there once uploads land)", () => {
    expect(onTerminalPath(`${LIVE_BASE}/review`)).toBe(true);
  });

  it("does not mistake any earlier pdf-intake page for the terminal section", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      if (new URL(dump.url).pathname.endsWith("/review")) continue;
      expect(onTerminalPath(dump.url), dump.url).toBe(false);
    }
  });

  it("still covers the guided forms' review-and-submit section", () => {
    expect(
      onTerminalPath(
        "https://my.uscis.gov/forms/application-to-extend-change-nonimmigrant-status/1/review-and-submit/review-your-application",
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-765 upload pages <-> doc-flow path matching", () => {
  // The exact page_path strings the backend is being built against.
  const BACKEND_PATHS = [
    "/form",
    "/form-g28",
    "/applicant-photo/I-765/evidence",
    "/form-i-94-passport/I-765/evidence",
    "/employment/I-765/evidence",
    "/form-i-485/I-765/evidence",
    "/form-i-797c/I-765/evidence",
    "/additional-evidence/I-765/evidence",
  ];
  const uploadPages = BACKEND_PATHS.map((page_path) => ({
    page_path,
    kind: "document" as const,
    doc_type: `doc-for${page_path}`,
  }));

  it("routes each backend page_path to exactly its own descriptor upload page", () => {
    // descriptorsForPage is a path-tail compare and the walk passes page.slug as
    // the path — so /form must match ONLY /form, never /form-g28 or an evidence
    // page, and vice versa.
    for (const page of I765_PAGES.filter((p) => p.kind === "upload")) {
      const matched = descriptorsForPage(page.slug, "", uploadPages);
      expect(matched.map((d) => d.page_path), page.slug).toEqual([page.slug]);
    }
  });

  it("matches the live URL path for every upload page too", () => {
    for (const page of I765_PAGES.filter((p) => p.kind === "upload")) {
      const livePath = new URL(`${LIVE_BASE}${page.slug}`).pathname;
      const matched = descriptorsForPage(livePath, "", uploadPages);
      expect(matched.map((d) => d.page_path), livePath).toEqual([page.slug]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE: the colliding radios are the one thing pdf-intake needs from the
// value-setter that the guided forms never exercised — resolving a radio GROUP
// by its question text when the descriptor's name is synthetic (in the DOM the
// name exists, but it names TWO different questions across pages).

describe("I-765 colliding radios: question-anchored resolution", () => {
  // The worst case: TWO groups with the SAME generic name on one document.
  // (Live they sit on different pages; same-name-same-page is the stress test.)
  const twoCollidingGroups = () =>
    setBody(
      `<div class="MuiFormControl-root">
         <h2>Are you able to pay the filing fee?</h2>
         <div role="radiogroup">
           <label>Yes<input type="radio" name="controlled-radio-buttons-group" value="Yes" /></label>
           <label>No<input type="radio" name="controlled-radio-buttons-group" value="No" /></label>
         </div>
       </div>
       <div class="MuiFormControl-root">
         <h2>You filed your I-485 with a fee on or after 04/01/2024 and your form is still pending.</h2>
         <div role="radiogroup">
           <label>Yes<input type="radio" name="controlled-radio-buttons-group" value="Yes" /></label>
           <label>No<input type="radio" name="controlled-radio-buttons-group" value="No" /></label>
         </div>
       </div>`,
    );

  beforeEach(() => setBody(""));

  it("clicks the Yes of the group under the anchored question, not the first Yes on the page", async () => {
    twoCollidingGroups();
    const feeGate = I765_PAGES.find((p) => p.slug === "/select-eligibility")!.fields.find(
      (f) => f.name === "select-eligibility.i485-fee-post-20240401",
    )!;
    const res = await setValue(
      { name: feeGate.name, kind: "radio", optionValue: "Yes", locate: feeGate.locate },
      "Yes",
    );
    expect(res.success).toBe(true);
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="Yes"]'),
    );
    expect(radios[0].checked, "clicked the WRONG (able-to-pay) group").toBe(false);
    expect(radios[1].checked).toBe(true);
  });

  it("locateElement finds a question-anchored radio group, so reveal-waits and probes see it", () => {
    // waitForRevealed and the conditional probe both go through locateElement;
    // without radio-group support there a located radio looks permanently
    // absent — the reveal wait burns its whole window and a conditional would
    // be skipped as "not shown" while sitting right on the page.
    twoCollidingGroups();
    const el = locateElement({
      name: "able-to-pay.can-pay-fee",
      kind: "radio",
      optionValue: "No",
      locate: { labelContains: "Are you able to pay the filing fee?" },
    });
    expect(el).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE 2026-09-12 FAILURE, end to end. /select-eligibility's eligibility
// control is a MUI SELECT, not an autocomplete: hidden named input (commits the
// code) + div[role="combobox"] display + a mousedown-opened popup portaled to
// document.body. The walk must still: drive it first, commit C9 into the hidden
// input, and then fill both radios the commit reveals (they re-render late).

describe("I-765 /select-eligibility with the LIVE MUI Select structure", () => {
  beforeEach(() => setBody(""));

  /** The captured option list (eligibility-options.json), with the two codes
   * read live off the input; the popup renders these labels. */
  const liveOptions = () => {
    const labels = JSON.parse(
      readFileSync(resolve(DUMP_DIR, "eligibility-options.json"), "utf-8"),
    ).options as string[];
    return labels.map((label) => ({
      label,
      value: label.startsWith("(c)(9)") ? "C9" : label.startsWith("(a)(12)") ? "A12" : "",
    }));
  };

  const appendRevealedRadios = (): void => {
    const div = document.createElement("div");
    div.innerHTML = `<div class="MuiFormControl-root">
        <h2>Is this an initial, replacement, or renewal request?</h2>
        <div role="radiogroup">
          <label>Initial<input type="radio" name="reason-for-filing-radio-group" value="Initial" /></label>
          <label>Replacement<input type="radio" name="reason-for-filing-radio-group" value="Replacement" /></label>
          <label>Renewal<input type="radio" name="reason-for-filing-radio-group" value="Renewal" /></label>
        </div>
      </div>
      <div class="MuiFormControl-root">
        <h2>You filed your I-485 with a fee on or after 04/01/2024 and your form is still pending.</h2>
        <div role="radiogroup">
          <label>Yes<input type="radio" name="controlled-radio-buttons-group" value="Yes" /></label>
          <label>No<input type="radio" name="controlled-radio-buttons-group" value="No" /></label>
        </div>
      </div>`;
    document.body.appendChild(div);
  };

  it("commits C9 through the select, then fills both late-revealed radios", async () => {
    const h = mountMuiSelect({
      name: "eligibility-choice",
      options: liveOptions(),
      // The radios re-render AFTER the commit lands, like the live page.
      onCommit: () => setTimeout(appendRevealedRadios, 250),
    });

    const page = I765_PAGES.find((p) => p.slug === "/select-eligibility")!;
    const res = await fillPage(page, CONVENTION_PAYLOAD);

    expect(h.input.value, "hidden input never committed the payload code").toBe("C9");
    expect(res.failed, `failures: ${JSON.stringify(res.results)}`).toBe(0);
    expect(res.filled).toBe(3);
    const reason = document.querySelector<HTMLInputElement>(
      'input[name="reason-for-filing-radio-group"]:checked',
    );
    expect(reason?.value, "reason radio missed after the reveal").toBe("Initial");
    const fee = document.querySelector<HTMLInputElement>(
      'input[name="controlled-radio-buttons-group"]:checked',
    );
    expect(fee?.value, "fee-gate radio missed after the reveal").toBe("Yes");
  }, 30000);
});

describe("I-765 pdf-intake Next button", () => {
  beforeEach(() => setBody(""));

  it("finds pdf-intake's next-btn testid (the guided forms use next-button)", () => {
    setBody('<button data-testid="next-btn">Next</button>');
    expect(findNextButton()?.getAttribute("data-testid")).toBe("next-btn");
  });

  it("never returns a Submit/Pay control whatever its testid says", () => {
    setBody('<button data-testid="next-btn">Pay and submit</button>');
    expect(findNextButton()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Descriptor <-> BACKEND VALUE MAP. The backend's I-765 map is being built in
// parallel against exactly the payload-key convention pinned above; this block
// self-skips until form_myuscis_definitions.json actually carries I-765
// definitions, then holds both sides together the way the I-539 guard does.

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);

function loadBackendI765(): { mapped: string[]; uploadPaths: string[] } | null {
  if (!existsSync(BACKEND_MAP)) return null;
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const mapped = new Set<string>();
  const uploadPaths = new Set<string>();
  let found = false;
  for (const key of Object.keys(json)) {
    const value = json[key];
    if (typeof value !== "object" || value === null) continue;
    const entry = value.definitions_from ? json[value.definitions_from] : value;
    const def = entry?.definitions?.["I-765"];
    if (!def) continue;
    found = true;
    for (const name of Object.keys(def.field_to_factkey_map ?? {})) mapped.add(name);
    for (const page of def.upload_pages ?? []) uploadPaths.add(page.page_path);
  }
  return found ? { mapped: [...mapped], uploadPaths: [...uploadPaths] } : null;
}

const BACKEND_I765 = loadBackendI765();

describe.skipIf(!BACKEND_I765)("I-765 descriptor <-> backend value map", () => {
  it("drives every field name the backend can emit", () => {
    const driven = new Set(fieldNamesOf(I765_PAGES));
    const missing = BACKEND_I765!.mapped.filter((n) => !driven.has(n) && !I765_SKIP.includes(n));
    expect(missing, `backend emits these but the descriptor never fills them: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("declares an upload page for every slot the backend can route to", () => {
    const uploadSlugs = new Set(I765_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug));
    // /able-to-pay is the one legitimate exception: the I-912 fee-waiver slot is
    // INLINE on that form page (revealed by answering No), not a page of its own.
    const undeclared = BACKEND_I765!.uploadPaths.filter(
      (p) => !uploadSlugs.has(p) && p !== "/able-to-pay",
    );
    expect(undeclared, `backend routes documents to undeclared pages: ${undeclared.join(", ")}`)
      .toEqual([]);
  });
});
