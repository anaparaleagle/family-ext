// ===========================================================================
// ETA-9141 — Application for Prevailing Wage Determination, on flag.dol.gov.
//
//   https://flag.dol.gov/dashboard/application/9141/<applicationId>
//
// The first of the two DOL PERM forms and the one filed first: the ETA-9089 needs
// this application's PWD case number, so there is no useful order other than
// this one.
//
// AUTHORED FROM THREE LIVE CAPTURES, not from the PDF. Field names, kinds, option
// values and reveals all come from
// `test/fixtures/flag-perm-field-dump/eta9141-run3.json`; `tools/NOTES-flag-perm.md`
// records what each run established. Where a capture and the paper form disagree,
// the capture wins — the extension types into the portal, not the PDF.
//
// SECTION ORDER is the sidebar's own order. There is no URL to navigate by.
// FIELD ORDER within a section is DOM order, except that a gate is listed before
// the fields it reveals so the chain drives the reveal first.
// ===========================================================================

import { FlagField, FlagFormConfig, FlagSection } from "./types";

// ── authoring helpers ───────────────────────────────────────────────────────
const t = (name: string): FlagField => ({ name, kind: "text" });
const area = (name: string): FlagField => ({ name, kind: "textarea" });
const sel = (name: string): FlagField => ({ name, kind: "select" });
const phone = (name: string): FlagField => ({ name, kind: "phone" });
const radio = (name: string): FlagField => ({ name, kind: "radio" });
/** A field revealed by an upstream answer. `is` carries FLAG's own option values. */
const when = (field: FlagField, by: string, is?: string[]): FlagField => ({
  ...field,
  revealedBy: { by, ...(is ? { is } : {}) },
});

// FLAG's Yes on THIS form is "1". Not "Yes" — see NOTES-flag-perm.md. Named so a
// reveal spec reads as the answer rather than as a magic string.
const YES = "1";

// ── the attorney block ──────────────────────────────────────────────────────
// Section D renders nothing but the representation radio until it is answered
// Attorney or Agent; answering None reveals nothing. Proven both ways in run 3,
// including the negative. So every field here is gated on the same two values.
const ATTORNEY_REVEALS = ["Attorney", "Agent"];
const atty = (field: FlagField): FlagField =>
  when(field, "attyRepresentType", ATTORNEY_REVEALS);

export const ETA9141_SECTIONS: FlagSection[] = [
  {
    navLabel: "Employment Based Visa Information",
    title: "A — Employment-Based Visa Information",
    fields: [sel("visaType")],
  },

  {
    navLabel: "Employer Point-of-Contact Information",
    title: "B — Employer Point-of-Contact Information",
    fields: [
      t("requestorPocLastName"),
      t("requestorPocFirstName"),
      t("requestorPocMiddleName"),
      t("requestorPocJobTitle"),
      t("requestorPocAddr1"),
      t("requestorPocAddr2"),
      // Country before state: FLAG filters the state list by country, so setting
      // the state first can write a value the list is about to stop offering.
      sel("requestorPocCountry"),
      t("requestorPocCity"),
      sel("requestorPocState"),
      t("requestorPocPostalCode"),
      t("requestorPocProvince"),
      phone("requestorPocPhone"),
      t("requestorPocPhoneExt"),
      t("requestorPocEmail"),
    ],
  },

  {
    navLabel: "Employer Information",
    title: "C — Employer Information",
    fields: [
      t("empBusinessName"),
      t("empTradeName"),
      t("empAddr1"),
      t("empAddr2"),
      sel("empCountry"),
      t("empCity"),
      sel("empState"),
      t("empPostcode"),
      t("empProvince"),
      phone("empPhone"),
      t("empPhoneext"),
      t("empFein"),
      // C.13 NAICS is deliberately absent — see NOT_AUTOFILLED below.
    ],
  },

  {
    navLabel: "Attorney or Agent Information",
    title: "D — Attorney or Agent Information",
    fields: [
      radio("attyRepresentType"),
      atty(t("attyLastname")),
      atty(t("attyFirstname")),
      atty(t("attyMiddlename")),
      atty(t("attyAddr1")),
      atty(t("attyAddr2")),
      atty(sel("attyCountry")),
      atty(t("attyCity")),
      atty(sel("attyState")),
      atty(t("attyPostcode")),
      atty(phone("attyPhone")),
      atty(t("attyPhoneext")),
      atty(t("attyEmail")),
      atty(t("attyBizname")),
      atty(t("attyFein")),
    ],
  },

  {
    // E.1-E.5 are the wage-source questions. Every one of them is a standing
    // "No unless the case says otherwise" in the backend map, so the feed
    // deliberately sends no value for any of them and this section normally
    // fills nothing. They are listed because a descriptor that omitted them
    // would make the section look complete when a caseworker still has five
    // questions to answer.
    navLabel: "Wage Source Information",
    title: "E — Wage Source Information",
    fields: [
      radio("coveredByAcwia"),
      radio("sportsLeague"),
      radio("cba"),
      radio("pre_dbaSca"),
      radio("dbaSurvey"),
    ],
  },

  {
    navLabel: "Job Description",
    title: "F.a — Job Description",
    fields: [t("jobTitle"), area("jobDuties"), radio("superviseOtherEmp")],
  },

  {
    navLabel: "Minimum Job Requirements",
    title: "F.b/F.c — Minimum and Alternative Job Requirements",
    fields: [
      // The education level gates both text boxes below it, so it goes first.
      radio("primaryEducationLevel"),
      // `major` appears for ASSOCIATES and above and NOT for NONE or
      // HIGHSCHOOLGED; `otherEducation` appears ONLY for OTHERDEGREE. Both
              // observed in run 3 with the negatives.
      when(area("major"), "primaryEducationLevel", [
        "ASSOCIATES",
        "BACHELORS",
        "MASTERS",
        "DOCTORATEPHD",
        "OTHERDEGREE",
      ]),
      when(area("otherEducation"), "primaryEducationLevel", ["OTHERDEGREE"]),
      radio("secondDiploma"),
      radio("trainingRequired"),
      radio("empExperienceRequired"),
      radio("isSpecialRequirements"),
      radio("altJobRequirement"),
    ],
  },

  {
    navLabel: "Other Information",
    title: "F.d — Other Information",
    fields: [
      // F.d.1 SOC code is deliberately absent — see NOT_AUTOFILLED below.
      t("supervisorJobTitle"),
      radio("travelRequired"),
      when(area("travelDetails"), "travelRequired", [YES]),
    ],
  },

  {
    navLabel: "Place of Employment Information",
    title: "F.e — Place of Employment Information",
    fields: [
      t("primaryWorksiteAddr1"),
      t("primaryWorksiteAddr2"),
      t("primaryWorksiteCity"),
      sel("primaryWorksiteState"),
      // No `name` attribute at all, only an id. The H-1B extension hit the same
      // field on the LCA. The feed does not currently send a county — the map
      // holds it as a suggestion for a person to confirm, because a ZIP can
      // straddle two counties and the county picks the wage area — so this entry
      // exists to be found, not yet to be filled.
      { name: "primaryWorksiteCounty", kind: "search", byId: true },
      t("primaryWorksitePostalCode"),
      radio("otherWorksiteLocation"),
    ],
  },

  {
    navLabel: "Additional Worksites",
    title: "APX A — Additional Worksites",
    fields: [],
    conditional: true,
  },
];

/**
 * Controls the runner must never touch. Enforced in the fill chain, not advice.
 *
 * The profile pickers are the dangerous ones. FLAG puts a "Select an Employer
 * profile to populate this section" combobox at the top of Sections B, C and D,
 * and choosing one repopulates the WHOLE section from DOL's stored profile. Fire
 * one after we have typed and it silently overwrites everything — the caseworker
 * sees a filled form built from the wrong company.
 */
export const ETA9141_FORBIDDEN = [
  {
    match: "employer-9141",
    reason:
      "FLAG's employer profile picker. Selecting a profile repopulates all of " +
      "Section C from DOL's stored copy and would overwrite what we typed.",
  },
  {
    match: "employer-pocs-9141",
    reason: "FLAG's point-of-contact profile picker. Repopulates all of Section B.",
  },
  {
    match: "agent-attorney-individs-9141",
    reason: "FLAG's attorney profile picker. Repopulates all of Section D.",
  },
  {
    match: "Select an Employer profile",
    reason:
      "The profile pickers are unnamed comboboxes; this matches them by their " +
      "visible label as well as by id.",
  },
];

/**
 * The two fields this extension will not fill, and why. Surfaced in the toolbar
 * so a caseworker knows to type them rather than discovering the blanks at DOL.
 *
 * Both are MUI comboboxes with NO name and NO id. The only selector the captures
 * could produce for them is a twelve-deep `nth-of-type` chain, which will not
 * survive a FLAG release — and the NAICS widget sits in Section C directly below
 * the employer PROFILE PICKER, which is also an unnamed combobox with a near
 * identical accessible label. A label- or position-based guess that lands on the
 * picker instead does not fail: it repopulates the entire section from DOL's
 * stored employer. Two fields typed by hand is a much better trade than that.
 */
export const ETA9141_NOT_AUTOFILLED = [
  { box: "C.13", label: "NAICS code", reason: "Unnamed combobox, adjacent to the employer profile picker." },
  { box: "F.d.1", label: "Suggested SOC (O*NET/OEWS) code", reason: "Unnamed combobox." },
];

export const ETA9141_CONFIG: FlagFormConfig = {
  formType: "ETA-9141",
  urlPattern: /\/dashboard\/application\/9141\//,
  label: "ParaLeagle ETA-9141",
  // PERM only, and deliberately NOT EB-2-PERM: that is a separate case type the
  // backend's ETA endpoints reject by name, so offering one here would produce a
  // 400 that reads as the extension being broken.
  caseTypes: ["PERM"],
  sections: ETA9141_SECTIONS,
  forbidden: ETA9141_FORBIDDEN,
};
