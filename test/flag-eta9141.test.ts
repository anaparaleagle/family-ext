// The ETA-9141 descriptor, checked against the two things it has to agree with:
// the live capture it was authored from, and the backend table that supplies its
// values. A descriptor that drifts from either does not throw — it silently fills
// fewer boxes, or types into the wrong one, on a federal form. So both joins are
// asserted on every run.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ETA9141_CONFIG,
  ETA9141_FORBIDDEN,
  ETA9141_NOT_AUTOFILLED,
  ETA9141_SECTIONS,
} from "../src/flag/eta9141-descriptor";
import { fillSection, isForbidden } from "../src/flag/fill-chain";
import { findSectionLink, matchesSection, findCommitButton, sectionIsRendered } from "../src/flag/nav";
import { flagFieldNames } from "../src/flag/types";

const CAPTURE = JSON.parse(
  readFileSync("test/fixtures/flag-perm-field-dump/eta9141-run3.json", "utf-8"),
) as {
  sections: {
    name: string;
    fields: { key: string; kind: string }[];
    reveals: { gate: string; answers: { value: string; revealedFields?: { key: string }[] }[] }[];
  }[];
};

/** Every field name the live capture saw, unconditional or revealed. */
function capturedNames(): Set<string> {
  const out = new Set<string>();
  for (const s of CAPTURE.sections) {
    for (const f of s.fields) out.add(f.key);
    for (const r of s.reveals)
      for (const a of r.answers) for (const f of a.revealedFields ?? []) out.add(f.key);
  }
  return out;
}

describe("descriptor vs the live capture", () => {
  it("drives no field the capture never saw", () => {
    // The guard against a hand-typed name. A descriptor field that is not on the
    // real form can never fill and never reports why — it just sits in the
    // not-rendered column looking like a FLAG problem.
    const seen = capturedNames();
    const invented = flagFieldNames(ETA9141_SECTIONS).filter((n) => !seen.has(n));
    expect(invented).toEqual([]);
  });

  it("claims every field the capture saw, except the ones deliberately excluded", () => {
    const driven = new Set(flagFieldNames(ETA9141_SECTIONS));
    const missing = [...capturedNames()].filter((n) => !driven.has(n));
    // What is legitimately absent:
    //   *PhoneCountry  — ISO-2 selects with no box number; the feed never emits one.
    //   combobox@...   — the two unnamed comboboxes, see ETA9141_NOT_AUTOFILLED.
    expect(
      missing.filter((n) => !/PhoneCountry$/.test(n) && !n.startsWith("combobox@")),
    ).toEqual([]);
  });

  it("uses FLAG's own option values in every reveal spec, not Yes/No", () => {
    // On THIS form Yes is "1". A reveal spec saying "Yes" would never match the
    // value the feed emits, so the gated field would be skipped as "gate not
    // answered" — a silent under-fill, not an error.
    for (const section of ETA9141_SECTIONS) {
      for (const field of section.fields) {
        for (const value of field.revealedBy?.is ?? []) {
          expect(value).not.toBe("Yes");
          expect(value).not.toBe("No");
        }
      }
    }
  });

  it("gates the whole attorney block on the representation radio", () => {
    const section = ETA9141_SECTIONS.find((s) => s.navLabel.includes("Attorney"))!;
    const [first, ...rest] = section.fields;
    expect(first.name).toBe("attyRepresentType");
    // Run 3 proved Attorney and Agent both reveal the block and None reveals
    // nothing, so every other field in the section must be gated on those two.
    for (const field of rest) {
      expect(field.revealedBy?.by).toBe("attyRepresentType");
      expect(field.revealedBy?.is).toEqual(["Attorney", "Agent"]);
    }
  });

  it("lists each gate before the fields it reveals", () => {
    // Descriptor order IS fill order. A field listed before its gate would be
    // attempted while still hidden.
    for (const section of ETA9141_SECTIONS) {
      const seen = new Set<string>();
      for (const field of section.fields) {
        if (field.revealedBy) expect(seen.has(field.revealedBy.by)).toBe(true);
        seen.add(field.name);
      }
    }
  });
});

describe("descriptor vs the backend table", () => {
  // A COMMITTED COPY of the family backend's flag_fields.json, which is the
  // source of truth. Copied rather than reached for across repos: this repo's CI
  // has no checkout of the backend, and a test that silently skips when a sibling
  // directory is missing passes vacuously on exactly the machine that matters.
  //
  // The copy is kept honest by `stays in sync with the backend` below, which runs
  // only when FAMILY_BACKEND_DIR points at a checkout — the same skip-or-verify
  // shape the backend's own ETA test uses for the PDFs it cannot commit.
  const TABLE = JSON.parse(
    readFileSync("test/fixtures/flag-perm-field-dump/flag_fields.json", "utf-8"),
  ) as { forms: Record<string, Record<string, { name: string; kind: string }>> };

  it("stays in sync with the backend", () => {
    const dir = process.env.FAMILY_BACKEND_DIR;
    if (!dir) {
      console.log(
        "skipped: set FAMILY_BACKEND_DIR to a family-backend checkout to verify " +
          "the committed copy of flag_fields.json is current",
      );
      return;
    }
    const live = readFileSync(`${dir}/family_visa/forms/eta/flag_fields.json`, "utf-8");
    const ours = readFileSync("test/fixtures/flag-perm-field-dump/flag_fields.json", "utf-8");
    expect(JSON.parse(ours)).toEqual(JSON.parse(live));
  });

  it("agrees with the backend on the kind of every shared field", () => {
    // The feed codes a value for the kind IT thinks the widget is; the descriptor
    // drives it as the kind THIS thinks it is. Disagree and the value is coded for
    // a select and typed into a radio, or vice versa.
    const byName = new Map(
      Object.values(TABLE.forms["ETA-9141"]).map((spec) => [spec.name, spec.kind]),
    );
    const mismatches: string[] = [];
    for (const section of ETA9141_SECTIONS) {
      for (const field of section.fields) {
        const backendKind = byName.get(field.name);
        if (!backendKind) continue;
        // `search` is this side's word for a combobox the backend calls text —
        // the county. Everything else must match exactly.
        const ours = field.kind === "search" ? "text" : field.kind;
        const theirs = backendKind === "textarea" ? "textarea" : backendKind;
        if (ours !== theirs && !(ours === "phone" && theirs === "text")) {
          mismatches.push(`${field.name}: descriptor=${field.kind} backend=${backendKind}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("drives every field the backend can actually send a value for", () => {
    // If the backend maps a box to a FLAG field and the descriptor does not drive
    // it, the value arrives and is silently dropped. `unclaimed` in the walk
    // report exists to catch that at runtime; this catches it at build time.
    const driven = new Set(flagFieldNames(ETA9141_SECTIONS));
    const excluded = new Set(["sectionIAgreement"]);
    const dropped = Object.values(TABLE.forms["ETA-9141"])
      .map((s) => s.name)
      .filter((n) => !driven.has(n) && !excluded.has(n) && !/PhoneCountry$/.test(n));
    expect(dropped).toEqual([]);
  });
});

describe("refusals", () => {
  it("refuses all three FLAG profile pickers", () => {
    // Selecting a profile repopulates a whole section from DOL's stored copy. If
    // one fires after we have typed, the caseworker gets a filled form built from
    // the wrong company and no warning.
    for (const id of ["employer-9141", "employer-pocs-9141", "agent-attorney-individs-9141"]) {
      const rule = isForbidden({ name: id, kind: "select" }, ETA9141_FORBIDDEN);
      expect(rule, `${id} must be refused`).toBeTruthy();
    }
  });

  it("does not refuse an ordinary employer field", () => {
    expect(isForbidden({ name: "empBusinessName", kind: "text" }, ETA9141_FORBIDDEN)).toBeNull();
  });

  it("names the two fields it will not autofill, with a reason", () => {
    expect(ETA9141_NOT_AUTOFILLED.map((f) => f.box)).toEqual(["C.13", "F.d.1"]);
    for (const f of ETA9141_NOT_AUTOFILLED) expect(f.reason).toBeTruthy();
  });

  it("refuses a picker found only by its visible label", () => {
    document.body.innerHTML =
      '<div><input id="x-picker" aria-label="Select an Employer profile to populate this section"></div>';
    const rule = isForbidden({ name: "x-picker", kind: "select" }, ETA9141_FORBIDDEN);
    expect(rule?.reason).toContain("profile");
  });
});

describe("navigation", () => {
  it("matches a sidebar entry that has the section letter glued on", () => {
    // FLAG renders "CEmployer Information", not "C. Employer Information".
    const section = ETA9141_SECTIONS.find((s) => s.navLabel === "Employer Information")!;
    expect(matchesSection("CEmployer Information", section)).toBe(true);
    expect(matchesSection("Employer Point-of-Contact Information", section)).toBe(false);
  });

  it("prefers the shortest matching entry over a wrapper that contains it", () => {
    document.body.innerHTML = `
      <nav>
        <li id="wrapper">AVisa<li id="target">CEmployer Information</li></li>
      </nav>`;
    const section = ETA9141_SECTIONS.find((s) => s.navLabel === "Employer Information")!;
    expect(findSectionLink(section)?.id).toBe("target");
  });

  it("never offers Submit as the commit button", () => {
    document.body.innerHTML = "<button>Submit</button><button>Sign and Submit</button>";
    expect(findCommitButton()).toBeNull();
  });

  it("finds Continue", () => {
    document.body.innerHTML = "<button>Back</button><button>Continue</button>";
    expect(findCommitButton()?.textContent).toBe("Continue");
  });

  it("does not claim an empty conditional section is rendered", () => {
    document.body.innerHTML = "";
    const apx = ETA9141_SECTIONS.find((s) => s.navLabel === "Additional Worksites")!;
    expect(sectionIsRendered(apx)).toBe(false);
  });
});

describe("filling a section", () => {
  it("types the values it has and reports the rest as no-value, not failures", async () => {
    document.body.innerHTML = `
      <input name="empBusinessName" />
      <input name="empCity" />
      <input name="empFein" />`;
    const section = {
      navLabel: "Employer Information",
      title: "C",
      fields: [
        { name: "empBusinessName", kind: "text" as const },
        { name: "empCity", kind: "text" as const },
        { name: "empFein", kind: "text" as const },
      ],
    };
    const out = await fillSection(section, { empBusinessName: "Northwind Systems Inc." }, []);
    expect(out.find((o) => o.name === "empBusinessName")?.status).toBe("filled");
    expect(out.find((o) => o.name === "empCity")?.status).toBe("no-value");
    expect(out.filter((o) => o.status === "failed")).toEqual([]);
  });

  it("stays quiet about a gated field whose gate we never answered", async () => {
    // The attorney block when the case has no attorney: fifteen absent inputs
    // that were never going to render. Reporting those as failures would bury a
    // real one.
    document.body.innerHTML = '<input name="attyRepresentType" type="radio" value="Attorney" />';
    const section = {
      navLabel: "Attorney or Agent Information",
      title: "D",
      fields: [
        { name: "attyRepresentType", kind: "radio" as const },
        {
          name: "attyLastname",
          kind: "text" as const,
          revealedBy: { by: "attyRepresentType", is: ["Attorney", "Agent"] },
        },
      ],
    };
    const out = await fillSection(section, { attyLastname: "Rivera" }, []);
    const atty = out.find((o) => o.name === "attyLastname")!;
    expect(atty.status).toBe("not-rendered");
    expect(atty.message).toContain("not answered");
  });

  it("refuses a forbidden control instead of typing into it", async () => {
    document.body.innerHTML = '<select name="employer-9141"><option>x</option></select>';
    const section = {
      navLabel: "Employer Information",
      title: "C",
      fields: [{ name: "employer-9141", kind: "select" as const }],
    };
    const out = await fillSection(section, { "employer-9141": "x" }, ETA9141_FORBIDDEN);
    expect(out[0].status).toBe("refused");
    expect(out[0].message).toContain("overwrite");
  });

  it("finds the worksite county by id, since it has no name attribute", async () => {
    // Live shape: <input id="primaryWorksiteCounty"> with no name at all. Without
    // the by-id strategy this reports "element not on page" for a field that is
    // right there — and the county picks the prevailing-wage area.
    document.body.innerHTML = '<input id="primaryWorksiteCounty" />';
    const section = {
      navLabel: "Place of Employment Information",
      title: "F.e",
      fields: [{ name: "primaryWorksiteCounty", kind: "text" as const, byId: true as const }],
    };
    const out = await fillSection(section, { primaryWorksiteCounty: "DuPage" }, []);
    expect(out[0].status).toBe("filled");
    expect(document.querySelector<HTMLInputElement>("#primaryWorksiteCounty")!.value).toBe("DuPage");
  });
});

describe("config", () => {
  it("recognises a 9141 application URL and not a 9089 one", () => {
    const p = ETA9141_CONFIG.urlPattern;
    expect(p.test("/dashboard/application/9141/6a831a2313a71d001e967db2")).toBe(true);
    expect(p.test("/dashboard/application/9089/6a831a28e1b3ef001c72d7ab")).toBe(false);
  });

  it("requests the feed as ETA-9141", () => {
    expect(ETA9141_CONFIG.formType).toBe("ETA-9141");
  });
});
