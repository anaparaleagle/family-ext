// Cross-check the I-131 PDF-INTAKE descriptor against the live field dump
// (test/fixtures/i131-online-field-dump/, captured 2026-09-15).
//
// Our cases file ADVANCE_PAROLE + PENDING_485 — advance parole on a pending
// adjustment — and that is the walk the dump captured live. The one structural
// difference from the I-485: the evidence slot list VARIES BY CATEGORY, so the
// category-specific pages are conditional rather than fixed.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
  I131_ADVANCE_PAROLE_EVIDENCE_SLUGS,
  I131_ADVANCE_PAROLE_SUBCATEGORIES,
  I131_CATEGORY_OPTION_LABELS,
  I131_PAGES,
  I131_SKIP,
  I131_UNIVERSAL_EVIDENCE_SLUGS,
} from "../src/i131/form-descriptor";
import {
  FORM_CONFIGS,
  I131_CONFIG,
  configForFormType,
  configForPath,
  formTypeForCaseType,
} from "../src/runner/registry";
import { pageForUrl } from "../src/runner/section-detector";
import { fieldNamesOf, FormPage } from "../src/runner/types";
import { onTerminalPath, planPageFill } from "../src/runner/fill-chain";
import { descriptorsForPage } from "../src/runner/doc-flow";

const DUMP_DIR = resolve(__dirname, "fixtures/i131-online-field-dump");
const PAGE_DUMPS = readdirSync(DUMP_DIR)
  .filter((f) => /^\d{2}-.*\.json$/.test(f))
  .sort();

const LIVE_BASE = "https://my.uscis.gov/pdf-intake/I-131/555dda9e-e712-3cdc-b12a-b3eaa30d6d48";

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
  file_inputs?: { accept: string; multiple: boolean }[];
}

function readDump(file: string): Dump {
  return JSON.parse(readFileSync(resolve(DUMP_DIR, file), "utf-8"));
}

function options() {
  return JSON.parse(readFileSync(resolve(DUMP_DIR, "eligibility-options.json"), "utf-8"));
}

function expectedKind(dump: Dump): FormPage["kind"] {
  if ((dump.fields ?? []).some((f) => f.name && f.type !== "file")) return "form";
  if (new URL(dump.url).pathname.endsWith("/review")) return "review";
  return "upload";
}

/** Driven by exact name, by name fragment, or by question anchor. */
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

describe("I-131 descriptor <-> live pdf-intake dump", () => {
  const skipped = new Set(I131_SKIP);

  it("resolves every captured page URL to exactly its own descriptor page", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      const page = pageForUrl(I131_PAGES, dump.url);
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
      const page = pageForUrl(I131_PAGES, dump.url)!;
      expect(page.kind, `${file} (${page.slug})`).toBe(expectedKind(dump));
    }
  });

  it("accounts for every fillable field in the capture, per page", () => {
    for (const file of PAGE_DUMPS) {
      const dump = readDump(file);
      const page = pageForUrl(I131_PAGES, dump.url)!;
      const unaccounted = (dump.fields ?? [])
        .filter((f) => f.name && f.type !== "file")
        .filter((f) => !pageAccountsFor(page, f) && !skipped.has(f.name!));
      expect(
        unaccounted.map((f) => f.name),
        `${file}: dump fields neither driven nor skipped`,
      ).toEqual([]);
    }
  });

  it("reaches the subcategory radio under the captured group name", () => {
    // The group is named from the category — here ADVANCE_PAROLE-subcategories.
    const captured = readDump("01-select-eligibility.json").fields!.find(
      (f) => f.type === "radio",
    )!;
    expect(captured.name).toBe("ADVANCE_PAROLE-subcategories");
    const sub = I131_PAGES.flatMap((p) => p.fields).find(
      (f) => f.name === "select-eligibility.subcategory",
    )!;
    const fragment = sub.locate!.nameContains!;
    expect(captured.name!.toLowerCase().includes(fragment.toLowerCase())).toBe(true);
    // Every category's group must match the same fragment, not just ours.
    for (const code of Object.keys(I131_CATEGORY_OPTION_LABELS)) {
      expect(`${code}-subcategories`.toLowerCase().includes(fragment.toLowerCase()), code).toBe(
        true,
      );
    }
  });

  it("declares the subcategory options as the CODES the radios commit", () => {
    const codes = options().subcategories_ADVANCE_PAROLE.options.map(
      (o: { value: string }) => o.value,
    );
    expect(I131_ADVANCE_PAROLE_SUBCATEGORIES).toEqual(codes);
    const captured = readDump("01-select-eligibility.json").fields!.find(
      (f) => f.type === "radio",
    )!;
    expect(I131_ADVANCE_PAROLE_SUBCATEGORIES).toContain(captured.value);
  });

  it("maps every category code to the label the Select renders", () => {
    for (const o of options()["eligibility-choice"].options) {
      if (!o.value) continue; // the "Select one" placeholder
      expect(I131_CATEGORY_OPTION_LABELS[o.value], o.value).toBe(o.label);
    }
    const elig = I131_PAGES.flatMap((p) => p.fields).find((f) => f.name === "eligibility-choice")!;
    expect(elig.kind).toBe("search");
    expect(elig.valueMap).toBe(I131_CATEGORY_OPTION_LABELS);
  });

  it("carries the ADVANCE_PAROLE label in full, CNMI tail included", () => {
    // The live label has a CNMI tail the shorthand name omits. A truncated label
    // filters the Select to zero options and the fill dies on the first field.
    expect(I131_CATEGORY_OPTION_LABELS.ADVANCE_PAROLE).toContain("Advance Parole Document");
    expect(I131_CATEGORY_OPTION_LABELS.ADVANCE_PAROLE).toContain("CNMI");
  });

  it("never both drives and skips the same field", () => {
    const driven = new Set(fieldNamesOf(I131_PAGES));
    expect([...I131_SKIP].filter((n) => driven.has(n))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-131 descriptor shape", () => {
  it("has unique slugs", () => {
    const slugs = I131_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("declares the two typed pages in captured walk order", () => {
    const forms = I131_PAGES.filter((p) => p.kind === "form");
    expect(forms.map((p) => p.slug)).toEqual(["/select-eligibility", "/client-information/0"]);
    // The has-client shape: three names, no Add Client gate.
    expect(forms[1].fields.map((f) => f.name)).toEqual(["firstName", "middleName", "lastName"]);
  });

  it("declares no able-to-pay page", () => {
    // ADVANCE_PAROLE and PENDING_485 are both feeWaivable:false, so the page
    // never renders on the branch we file. Declaring it from the I-485's slug
    // would be an unverified guess; an unexpected page is logged and walked past.
    expect(I131_PAGES.map((p) => p.slug)).not.toContain("/able-to-pay");
  });

  it("declares every upload page with the exact page_path the backend emits", () => {
    const uploads = I131_PAGES.filter((p) => p.kind === "upload");
    expect(uploads.map((p) => p.slug)).toEqual([
      "/form",
      "/form-g28",
      "/applicant-photo/I-131/evidence",
      "/photo-id/I-131/evidence",
      "/form-i-797/I-131/evidence",
      "/form-i-797c/I-131/evidence",
      "/additional-evidence/I-131/evidence",
    ]);
    for (const p of uploads) expect(p.fields.length, p.slug).toBe(0);
  });

  it("carries the /I-131/evidence suffix, not the I-485's", () => {
    // The suffix tracks the form type; a copied /I-485/evidence slug would match
    // nothing and attach nothing, silently.
    for (const p of I131_PAGES.filter((p) => p.slug.includes("/evidence"))) {
      expect(p.slug.endsWith("/I-131/evidence"), p.slug).toBe(true);
    }
  });

  it("marks the category-specific evidence pages conditional and the universal ones not", () => {
    // THE difference from the I-485, whose 14 slots are fixed for every
    // combination. Here REENTRY_PERMIT renders 3 slots and ADVANCE_PAROLE 5.
    const bySlug = new Map(I131_PAGES.map((p) => [p.slug, p]));
    for (const id of I131_UNIVERSAL_EVIDENCE_SLUGS) {
      expect(bySlug.get(`/${id}/I-131/evidence`)?.conditional, id).toBeFalsy();
    }
    for (const id of I131_ADVANCE_PAROLE_EVIDENCE_SLUGS) {
      expect(bySlug.get(`/${id}/I-131/evidence`)?.conditional, id).toBe(true);
    }
  });

  it("agrees with the per-category evidence table in the capture", () => {
    const groups = options().evidence_groups_by_category;
    // Universal = present for every one of the seven categories.
    const everywhere = Object.values(groups).reduce<string[]>(
      (acc: string[], list) =>
        acc.filter((id) => (list as { id: string }[]).some((g) => g.id === id)),
      (groups.ADVANCE_PAROLE as { id: string }[]).map((g) => g.id),
    );
    expect(everywhere.sort()).toEqual([...I131_UNIVERSAL_EVIDENCE_SLUGS].sort());
    // And ours adds exactly the two I-797 slots.
    const ours = (groups.ADVANCE_PAROLE as { id: string }[]).map((g) => g.id);
    expect(ours.filter((id) => !everywhere.includes(id))).toEqual(
      I131_ADVANCE_PAROLE_EVIDENCE_SLUGS,
    );
  });

  it("terminates on the captured review page, which is last and fills nothing", () => {
    const reviews = I131_PAGES.filter((p) => p.kind === "review");
    expect(reviews.map((p) => p.slug)).toEqual(["/review"]);
    expect(reviews[0].fields).toEqual([]);
    expect(I131_PAGES[I131_PAGES.length - 1].kind).toBe("review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const CONVENTION_PAYLOAD: Record<string, string> = {
  "eligibility-choice": "ADVANCE_PAROLE",
  "select-eligibility.subcategory": "PENDING_485",
  firstName: "Maya",
  middleName: "",
  lastName: "Okafor",
};

describe("I-131 payload convention -> fill plan", () => {
  const selectEligibility = () => I131_PAGES.find((p) => p.slug === "/select-eligibility")!;

  it("drives the category before the subcategory it reveals", () => {
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    expect(plan.map((p) => p.spec.name)).toEqual([
      "eligibility-choice",
      "select-eligibility.subcategory",
    ]);
  });

  it("translates the category code to its label and keeps the code as commitValue", () => {
    const plan = planPageFill(selectEligibility(), CONVENTION_PAYLOAD);
    const elig = plan.find((p) => p.spec.name === "eligibility-choice")!;
    expect(elig.value).toBe(I131_CATEGORY_OPTION_LABELS.ADVANCE_PAROLE);
    expect(elig.spec.commitValue).toBe("ADVANCE_PAROLE");
  });

  it("drops the subcategory when the payload never chose a category", () => {
    expect(
      planPageFill(selectEligibility(), { "select-eligibility.subcategory": "PENDING_485" }),
    ).toEqual([]);
  });

  it("plans every client-information value it is sent", () => {
    const client = I131_PAGES.find((p) => p.slug === "/client-information/0")!;
    expect(planPageFill(client, CONVENTION_PAYLOAD).map((p) => p.spec.name)).toEqual([
      "firstName",
      "lastName", // middleName is "" -> legitimately omitted
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-131 registry entry", () => {
  it("declares the pdf-intake host path and the IR case types", () => {
    expect(I131_CONFIG.formType).toBe("I-131");
    expect(I131_CONFIG.hostPath).toBe("/pdf-intake/I-131/");
    expect(I131_CONFIG.pages).toBe(I131_PAGES);
    expect(I131_CONFIG.caseTypes).toEqual(["IR-1", "IR-2", "IR-5"]);
    expect(FORM_CONFIGS).toContain(I131_CONFIG);
  });

  it("routes live I-131 URLs to the I-131 config, not the I-485 or I-765", () => {
    for (const file of PAGE_DUMPS) {
      const path = new URL(readDump(file).url).pathname;
      expect(configForPath(path)?.formType, path).toBe("I-131");
    }
  });

  it("looks the config up by backend form_type", () => {
    expect(configForFormType("I-131")).toBe(I131_CONFIG);
  });

  it("keeps the case-type auto-switch on the I-130 for the shared IR types", () => {
    for (const code of ["IR-1", "IR-2", "IR-5"]) {
      expect(formTypeForCaseType(code)).toBe("I-130");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("I-131 terminal guard", () => {
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

describe("I-131 upload pages <-> doc-flow path matching", () => {
  const uploadPages = I131_PAGES.filter((p) => p.kind === "upload").map((p) => ({
    page_path: p.slug,
    kind: "document" as const,
    doc_type: `doc-for${p.slug}`,
  }));

  it("routes each page_path to exactly its own descriptor upload page", () => {
    // /form must match ONLY /form — never /form-g28, /form-i-797 or /form-i-797c.
    for (const page of I131_PAGES.filter((p) => p.kind === "upload")) {
      expect(descriptorsForPage(page.slug, "", uploadPages).map((d) => d.page_path), page.slug)
        .toEqual([page.slug]);
    }
  });

  it("matches the live URL path for every upload page too", () => {
    for (const page of I131_PAGES.filter((p) => p.kind === "upload")) {
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

function loadBackendI131(): { mapped: string[]; uploadPaths: string[] } | null {
  if (!existsSync(BACKEND_MAP)) return null;
  const json = JSON.parse(readFileSync(BACKEND_MAP, "utf-8"));
  const mapped = new Set<string>();
  const uploadPaths = new Set<string>();
  let found = false;
  for (const key of Object.keys(json)) {
    const value = json[key];
    if (typeof value !== "object" || value === null) continue;
    const entry = value.definitions_from ? json[value.definitions_from] : value;
    const def = entry?.definitions?.["I-131"];
    if (!def) continue;
    found = true;
    for (const name of Object.keys(def.field_to_factkey_map ?? {})) mapped.add(name);
    for (const page of def.upload_pages ?? []) uploadPaths.add(page.page_path);
  }
  return found ? { mapped: [...mapped], uploadPaths: [...uploadPaths] } : null;
}

const BACKEND_I131 = loadBackendI131();

describe.skipIf(!BACKEND_I131)("I-131 descriptor <-> backend value map", () => {
  it("drives every field name the backend can emit", () => {
    const driven = new Set(fieldNamesOf(I131_PAGES));
    const missing = BACKEND_I131!.mapped.filter((n) => !driven.has(n) && !I131_SKIP.includes(n));
    expect(missing, `backend emits but the descriptor never fills: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("declares an upload page for every slot the backend can route to", () => {
    const uploadSlugs = new Set(I131_PAGES.filter((p) => p.kind === "upload").map((p) => p.slug));
    const undeclared = BACKEND_I131!.uploadPaths.filter((p) => !uploadSlugs.has(p));
    expect(undeclared, `backend routes to undeclared pages: ${undeclared.join(", ")}`).toEqual([]);
  });
});
