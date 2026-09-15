// Cross-check the I-485 PDF-INTAKE descriptor against the live field dump
// (test/fixtures/i485-online-field-dump/, captured 2026-09-15).
//
//   every fillable field pdf-intake renders is either
//     (a) in I485_PAGES — driven, by name, question anchor or name fragment, or
//     (b) in I485_SKIP  — deliberately left to the user, on the record.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
  I485_APPLICANT_OPTION_LABELS,
  I485_CATEGORY_OPTION_LABELS,
  I485_EMPLOYMENT_SUBCATEGORIES,
  I485_EVIDENCE_SLUGS,
  I485_FAMILY_SUBCATEGORIES,
  I485_PAGES,
  I485_SKIP,
} from "../src/i485/form-descriptor";
import {
  FORM_CONFIGS,
  I485_CONFIG,
  configForFormType,
  configForPath,
  formTypeForCaseType,
} from "../src/runner/registry";
import { pageForUrl } from "../src/runner/section-detector";
import { fieldNamesOf, FormPage } from "../src/runner/types";
import { onTerminalPath, planPageFill } from "../src/runner/fill-chain";
import { descriptorsForPage } from "../src/runner/doc-flow";

const DUMP_DIR = resolve(__dirname, "fixtures/i485-online-field-dump");
const PAGE_DUMPS = readdirSync(DUMP_DIR)
  .filter((f) => /^\d{2}-.*\.json$/.test(f))
  .sort();
const BRANCH_DUMPS = [
  "branch-employment-based-select-eligibility.json",
  "branch-derivative-applicant-select-eligibility.json",
  "branch-able-to-pay-no.json",
];

const LIVE_BASE = "https://my.uscis.gov/pdf-intake/I-485/5ab9035c-215b-3079-b383-dc2016afccad";

interface DumpField {
  name: string | null;
  tag: string;
  type: string;
  label?: string;
  question?: string;
  options?: string[];
  value?: string;
}

interface Dump {
  url: string;
  heading: string;
  fields?: DumpField[];
  buttons?: { text: string }[];
  file_inputs?: { accept: string; multiple: boolean }[];
}

function readDump(file: string): Dump {
  return JSON.parse(readFileSync(resolve(DUMP_DIR, file), "utf-8"));
}

function expectedKind(dump: Dump): FormPage["kind"] {
  if ((dump.fields ?? []).some((f) => f.name && f.type !== "file")) return "form";
  if (new URL(dump.url).pathname.endsWith("/review")) return "review";
  return "upload";
}

/** Driven by exact name, by question anchor, or by a name fragment. */
function pageAccountsFor(page: FormPage, field: DumpField): boolean {
  return page.fields.some((f) => {
    if (f.name === field.name) return true;
    const fragment = f.locate?.nameContains;
    if (fragment && field.name?.toLowerCase().includes(fragment.toLowerCase())) return true;
    const anchor = f.locate?.labelContains;
    if (!anchor) return false;
    const haystack = `${field.question ?? ""} ${field.label ?? ""}`.toLowerCase();
    return haystack.includes(anchor.toLowerCase());
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("I-485 descriptor <-> live pdf-intake dump", () => {
  const skipped = new Set(I485_SKIP);

  it("resolves every captured page URL to exactly its own descriptor page", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      const page = pageForUrl(I485_PAGES, dump.url);
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
      const page = pageForUrl(I485_PAGES, dump.url)!;
      expect(page.kind, `${file} (${page.slug})`).toBe(expectedKind(dump));
    }
  });

  it("accounts for every fillable field in the capture, per page, branches included", () => {
    for (const file of [...PAGE_DUMPS, ...BRANCH_DUMPS]) {
      const dump = readDump(file);
      const page = pageForUrl(I485_PAGES, dump.url)!;
      const unaccounted = (dump.fields ?? [])
        .filter((f) => f.name && f.type !== "file")
        .filter((f) => !pageAccountsFor(page, f) && !skipped.has(f.name!));
      expect(
        unaccounted.map((f) => f.name),
        `${file}: dump fields neither driven nor skipped`,
      ).toEqual([]);
    }
  });

  it("drives the A-number checkbox, which the capture shows has no name attribute", () => {
    const dump = readDump("03-client-information.json");
    const nameless = (dump.fields ?? []).filter((f) => !f.name && f.type !== "file");
    expect(nameless.map((f) => f.label)).toEqual([
      "The Client does not know or have their A-Number",
    ]);
    const page = I485_PAGES.find((p) => p.slug === "/client-information/0")!;
    const box = page.fields.find((f) => f.name === "client-information.a-number-unknown")!;
    expect(box.kind).toBe("checkbox");
    expect(nameless[0].label!.toLowerCase()).toContain(box.locate!.labelContains!.toLowerCase());
  });

  it('advances About Your New Client with the "Add Client" button the capture shows', () => {
    const page = I485_PAGES.find((p) => p.slug === "/client-information/0")!;
    expect(page.advanceButtonText).toBe("Add Client");
    const buttons = (readDump("03-client-information.json").buttons ?? []).map((b) =>
      b.text.trim(),
    );
    expect(buttons).toContain(page.advanceButtonText);
  });

  it("never drives the colliding MUI default radio name literally", () => {
    // `controlled-radio-buttons-group` names the Six-and-Six question on
    // /select-eligibility AND the fee question on /able-to-pay.
    expect(fieldNamesOf(I485_PAGES)).not.toContain("controlled-radio-buttons-group");
  });

  it("anchors each colliding radio to the question text the capture shows", () => {
    const cases = [
      { file: "01-select-eligibility.json", name: "select-eligibility.six-and-six" },
      { file: "02-able-to-pay.json", name: "able-to-pay.can-pay-fee" },
    ];
    for (const { file, name } of cases) {
      const dump = readDump(file);
      const page = pageForUrl(I485_PAGES, dump.url)!;
      const field = page.fields.find((f) => f.name === name)!;
      expect(field.kind).toBe("radio");
      expect(field.options).toEqual(["Yes", "No"]);
      const question = dump.fields!.find(
        (f) => f.name === "controlled-radio-buttons-group",
      )!.question!;
      expect(field.locate?.labelContains, `${name} needs a question anchor`).toBeTruthy();
      expect(question.toLowerCase()).toContain(field.locate!.labelContains!.toLowerCase());
    }
  });

  it("reaches the subcategory radio under BOTH of its captured group names", () => {
    // The group is named from eligibility-choice: PrincipalApplicant-subcategories
    // or DerivativeApplicant-subcategories. One logical key, matched by fragment.
    const page = I485_PAGES.find((p) => p.slug === "/select-eligibility")!;
    const sub = page.fields.find((f) => f.name === "select-eligibility.subcategory")!;
    const fragment = sub.locate!.nameContains!;
    for (const name of ["PrincipalApplicant-subcategories", "DerivativeApplicant-subcategories"]) {
      expect(name.toLowerCase().includes(fragment.toLowerCase()), name).toBe(true);
    }
  });

  it("declares the subcategory options as the CODES the radios commit, not their labels", () => {
    const options = JSON.parse(
      readFileSync(resolve(DUMP_DIR, "eligibility-options.json"), "utf-8"),
    );
    expect(I485_FAMILY_SUBCATEGORIES).toEqual(
      options.subcategories_FAMILY_BASED.map((o: { value: string }) => o.value),
    );
    expect(I485_EMPLOYMENT_SUBCATEGORIES).toEqual(
      options.subcategories_EMPLOYMENT_BASED.map((o: { value: string }) => o.value),
    );
    const sub = I485_PAGES.flatMap((p) => p.fields).find(
      (f) => f.name === "select-eligibility.subcategory",
    )!;
    const captured = readDump("01-select-eligibility.json").fields!.find(
      (f) => f.name === "PrincipalApplicant-subcategories",
    )!;
    expect(sub.options).toContain(captured.value);
  });

  it("maps both autocomplete codes to the labels the widgets filter on", () => {
    const options = JSON.parse(
      readFileSync(resolve(DUMP_DIR, "eligibility-options.json"), "utf-8"),
    );
    for (const [label, code] of Object.entries(options["eligibility-choice"].values)) {
      expect(I485_APPLICANT_OPTION_LABELS[code as string]).toBe(label);
    }
    for (const [label, code] of Object.entries(options["eligibility-category-choice"].values)) {
      expect(I485_CATEGORY_OPTION_LABELS[code as string]).toBe(label);
    }
  });

  it("never both drives and skips the same field", () => {
    const driven = new Set(fieldNamesOf(I485_PAGES));
    expect([...I485_SKIP].filter((n) => driven.has(n))).toEqual([]);
  });

  it("skips nothing that pdf-intake does not actually render", () => {
    const captured = new Set<string>();
    for (const file of [...PAGE_DUMPS, ...BRANCH_DUMPS]) {
      for (const f of readDump(file).fields ?? []) if (f.name) captured.add(f.name);
    }
    const phantom = I485_SKIP.filter((n) => !captured.has(n));
    expect(phantom, `skip entries in no capture: ${phantom.join(", ")}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-485 descriptor shape", () => {
  it("has unique slugs", () => {
    const slugs = I485_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("declares the three typed pages in captured walk order", () => {
    const forms = I485_PAGES.filter((p) => p.kind === "form");
    expect(forms.map((p) => p.slug)).toEqual([
      // able-to-pay is page 2 here; on the I-765 it came after client-information.
      "/select-eligibility",
      "/able-to-pay",
      "/client-information/0",
    ]);
    expect(forms[2].fields.map((f) => f.name)).toEqual([
      "firstName",
      "middleName",
      "lastName",
      "aNumber",
      "client-information.a-number-unknown",
      "dateOfBirth",
      "emailAddress",
    ]);
  });

  it("declares all 16 upload pages with the exact page_path the backend emits", () => {
    const uploads = I485_PAGES.filter((p) => p.kind === "upload");
    expect(uploads.map((p) => p.slug)).toEqual([
      "/form",
      "/form-g28",
      ...I485_EVIDENCE_SLUGS.map((s) => `/${s}/I-485/evidence`),
    ]);
    expect(uploads).toHaveLength(16);
    for (const p of uploads) expect(p.fields.length, p.slug).toBe(0);
  });

  it("declares every evidence slug the capture walked, and no others", () => {
    const captured = PAGE_DUMPS.map((f) => new URL(readDump(f).url).pathname)
      .filter((p) => p.endsWith("/I-485/evidence"))
      .map((p) => p.split("/").slice(-3)[0]);
    expect(I485_EVIDENCE_SLUGS).toEqual(captured);
  });

  it("terminates on the captured review page, which is last and fills nothing", () => {
    const reviews = I485_PAGES.filter((p) => p.kind === "review");
    expect(reviews.map((p) => p.slug)).toEqual(["/review"]);
    expect(reviews[0].fields).toEqual([]);
    expect(I485_PAGES[I485_PAGES.length - 1].kind).toBe("review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const CONVENTION_PAYLOAD: Record<string, string> = {
  "eligibility-choice": "PrincipalApplicant",
  "eligibility-category-choice": "FAMILY_BASED",
  "select-eligibility.subcategory": "USC_SPOUSE",
  "select-eligibility.six-and-six": "No",
  "able-to-pay.can-pay-fee": "Yes",
  firstName: "Maya",
  middleName: "",
  lastName: "Okafor",
  aNumber: "A123456789",
  dateOfBirth: "01/02/1990",
  emailAddress: "maya@example.com",
};

describe("I-485 payload convention -> fill plan", () => {
  const selectEligibility = () => I485_PAGES.find((p) => p.slug === "/select-eligibility")!;

  it("drives the three cascading controls in reveal order", () => {
    // Six-and-Six is revealed by control 1, so it is driven as soon as that
    // lands — before the category chain, and safely: only the subcategory is
    // cleared when control 1 or 2 changes.
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    expect(plan.map((p) => p.spec.name)).toEqual([
      "eligibility-choice",
      "select-eligibility.six-and-six",
      "eligibility-category-choice",
      "select-eligibility.subcategory",
    ]);
  });

  it("translates both autocomplete codes to labels and keeps the code as commitValue", () => {
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    const applicant = plan.find((p) => p.spec.name === "eligibility-choice")!;
    expect(applicant.value).toBe("Principal Applicant");
    expect(applicant.spec.commitValue).toBe("PrincipalApplicant");
    const category = plan.find((p) => p.spec.name === "eligibility-category-choice")!;
    expect(category.value).toBe("Family-based");
    expect(category.spec.commitValue).toBe("FAMILY_BASED");
  });

  it("drops the revealed controls when the payload never chose an applicant type", () => {
    const plan = planPageFill(selectEligibility(), {
      "select-eligibility.subcategory": "USC_SPOUSE",
      "select-eligibility.six-and-six": "No",
    });
    expect(plan).toEqual([]);
  });

  it("plans every client-information value it is sent", () => {
    const client = I485_PAGES.find((p) => p.slug === "/client-information/0")!;
    expect(planPageFill(client, CONVENTION_PAYLOAD).map((p) => p.spec.name)).toEqual([
      "firstName",
      "lastName", // middleName is "" -> legitimately omitted
      "aNumber",
      "dateOfBirth",
      "emailAddress",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-485 registry entry", () => {
  it("declares the pdf-intake host path and the IR case types", () => {
    expect(I485_CONFIG.formType).toBe("I-485");
    expect(I485_CONFIG.hostPath).toBe("/pdf-intake/I-485/");
    expect(I485_CONFIG.pages).toBe(I485_PAGES);
    expect(I485_CONFIG.caseTypes).toEqual(["IR-1", "IR-2", "IR-5"]);
    expect(FORM_CONFIGS).toContain(I485_CONFIG);
  });

  it("routes live I-485 URLs to the I-485 config, not the I-765", () => {
    for (const file of PAGE_DUMPS) {
      const path = new URL(readDump(file).url).pathname;
      expect(configForPath(path)?.formType, path).toBe("I-485");
    }
  });

  it("looks the config up by backend form_type", () => {
    expect(configForFormType("I-485")).toBe(I485_CONFIG);
  });

  it("keeps the case-type auto-switch on the I-130 for the shared IR types", () => {
    for (const code of ["IR-1", "IR-2", "IR-5"]) {
      expect(formTypeForCaseType(code)).toBe("I-130");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-485 terminal guard", () => {
  it("stops on the pdf-intake /review page", () => {
    expect(onTerminalPath(`${LIVE_BASE}/review`)).toBe(true);
  });

  it("does not mistake any earlier page for the terminal section", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      if (new URL(dump.url).pathname.endsWith("/review")) continue;
      expect(onTerminalPath(dump.url), dump.url).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-485 upload pages <-> doc-flow path matching", () => {
  const uploadPages = I485_PAGES.filter((p) => p.kind === "upload").map((p) => ({
    page_path: p.slug,
    kind: "document" as const,
    doc_type: `doc-for${p.slug}`,
  }));

  it("routes each page_path to exactly its own descriptor upload page", () => {
    // /form must match ONLY /form — never /form-g28 or an evidence page.
    for (const page of I485_PAGES.filter((p) => p.kind === "upload")) {
      expect(descriptorsForPage(page.slug, "", uploadPages).map((d) => d.page_path), page.slug)
        .toEqual([page.slug]);
    }
  });

  it("matches the live URL path for every upload page too", () => {
    for (const page of I485_PAGES.filter((p) => p.kind === "upload")) {
      const livePath = new URL(`${LIVE_BASE}${page.slug}`).pathname;
      expect(descriptorsForPage(livePath, "", uploadPages).map((d) => d.page_path), livePath)
        .toEqual([page.slug]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_MAP = resolve(
  __dirname,
  "../../paraleagle-family-backend/family_visa/visa_config/bundles/form_myuscis_definitions.json",
);

function loadBackendI485(): { mapped: string[]; uploadPaths: string[] } | null {
  if (!existsSync(BACKEND_MAP)) return null;
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const mapped = new Set<string>();
  const uploadPaths = new Set<string>();
  let found = false;
  for (const key of Object.keys(json)) {
    const value = json[key];
    if (typeof value !== "object" || value === null) continue;
    const entry = value.definitions_from ? json[value.definitions_from] : value;
    const def = entry?.definitions?.["I-485"];
    if (!def) continue;
    found = true;
    for (const name of Object.keys(def.field_to_factkey_map ?? {})) mapped.add(name);
    for (const page of def.upload_pages ?? []) uploadPaths.add(page.page_path);
  }
  return found ? { mapped: [...mapped], uploadPaths: [...uploadPaths] } : null;
}

const BACKEND_I485 = loadBackendI485();

describe.skipIf(!BACKEND_I485)("I-485 descriptor <-> backend value map", () => {
  it("drives every field name the backend can emit", () => {
    const driven = new Set(fieldNamesOf(I485_PAGES));
    const missing = BACKEND_I485!.mapped.filter((n) => !driven.has(n) && !I485_SKIP.includes(n));
    expect(missing, `backend emits but the descriptor never fills: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("declares an upload page for every slot the backend can route to", () => {
    const uploadSlugs = new Set(I485_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug));
    const undeclared = BACKEND_I485!.uploadPaths.filter((p) => !uploadSlugs.has(p));
    expect(undeclared, `backend routes to undeclared pages: ${undeclared.join(", ")}`).toEqual([]);
  });
});
