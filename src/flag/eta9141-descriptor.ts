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

import { FlagField, FlagFormConfig, FlagSection, NotAutofilled } from "./types";

// ── authoring helpers ───────────────────────────────────────────────────────
const t = (name: string): FlagField => ({ name, kind: "text" });
const area = (name: string): FlagField => ({ name, kind: "textarea" });
const sel = (name: string): FlagField => ({ name, kind: "select" });
const date = (name: string): FlagField => ({ name, kind: "date" });
const phone = (name: string): FlagField => ({ name, kind: "phone", widget: "typed-phone" });
const radio = (name: string): FlagField => ({ name, kind: "radio", widget: "label-click" });
const box = (name: string): FlagField => ({ name, kind: "checkbox", widget: "label-click" });
const code = (name: string, boxPrefix: string, multi?: true): FlagField => ({
  name,
  kind: "search",
  widget: "autosuggest",
  boxPrefix,
  ...(multi ? { multi } : {}),
});
/** A field revealed by an upstream answer. `is` carries FLAG's own option values. */
const when = (field: FlagField, by: string, is?: string[]): FlagField => ({
  ...field,
  revealedBy: { by, ...(is ? { is } : {}) },
});

// FLAG's Yes on THIS form is "1". Not "Yes" — see NOTES-flag-perm.md. Named so a
// reveal spec reads as the answer rather than as a magic string.
const YES = "1";
const TICKED = "true";
const WITH_MAJOR = ["ASSOCIATES", "BACHELORS", "MASTERS", "DOCTORATEPHD", "OTHERDEGREE"];

/** The four special-requirement checkboxes, each opening its own textarea. */
function specialRequirements(gate: string, boxPrefix: string, areaPrefix: string): FlagField[] {
  return ["LicenseCert", "ForeignLang", "ResFellow", "Other"].flatMap((kind) => {
    const tick = `${boxPrefix}${kind}`;
    return [
      when(box(tick), gate, [YES]),
      { ...when(area(`${areaPrefix}${kind}`), tick, [TICKED]), afterName: tick },
    ];
  });
}

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
      code("naicsCode", "C.13"),
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
    navLabel: "Wage Source Information",
    title: "E — Wage Source Information",
    fields: [
      radio("coveredByAcwia"),
      when(box("acwiaHigherEdu"), "coveredByAcwia", [YES]),
      when(box("acwiaAffiliated"), "coveredByAcwia", [YES]),
      when(box("acwiaNonprofit"), "coveredByAcwia", [YES]),
      when(radio("acwiaStatusChange"), "coveredByAcwia", [YES]),
      radio("sportsLeague"),
      radio("cba"),
      radio("pre_dbaSca"),
      when(radio("dbaSca"), "pre_dbaSca", [YES]),
      radio("dbaSurvey"),
      when(t("surveyName"), "dbaSurvey", [YES]),
      when(date("surveyPublicationDate"), "dbaSurvey", [YES]),
    ],
  },

  {
    navLabel: "Job Description",
    title: "F.a — Job Description",
    fields: [
      t("jobTitle"),
      area("jobDuties"),
      radio("superviseOtherEmp"),
      when(code("supervisedSocCodes", "F.a.3.a", true), "superviseOtherEmp", [YES]),
    ],
  },

  {
    navLabel: "Minimum Job Requirements",
    title: "F.b/F.c — Minimum and Alternative Job Requirements",
    fields: [
      radio("primaryEducationLevel"),
      when(area("major"), "primaryEducationLevel", WITH_MAJOR),
      when(area("otherEducation"), "primaryEducationLevel", ["OTHERDEGREE"]),
      radio("secondDiploma"),
      when(area("secondDiplomaMajor"), "secondDiploma", [YES]),
      radio("trainingRequired"),
      when(t("numberOfMonthsTraining"), "trainingRequired", [YES]),
      when(area("nameRequiredTraining"), "trainingRequired", [YES]),
      radio("empExperienceRequired"),
      when(t("empExperienceMonths"), "empExperienceRequired", [YES]),
      when(area("occupationRequired"), "empExperienceRequired", [YES]),
      radio("isSpecialRequirements"),
      ...specialRequirements("isSpecialRequirements", "isSpecReq", "specReq"),
      radio("altJobRequirement"),
      when(radio("altEducationLevel"), "altJobRequirement", [YES]),
      when(area("altMajor"), "altEducationLevel", WITH_MAJOR),
      when(radio("altTrainingReq"), "altJobRequirement", [YES]),
      when(t("altNumMonthsTraining"), "altTrainingReq", [YES]),
      when(area("altNameReqdTraining"), "altTrainingReq", [YES]),
      when(radio("altEmpExperienceReqd"), "altJobRequirement", [YES]),
      when(t("altEmpExpNumMonths"), "altEmpExperienceReqd", [YES]),
      when(radio("isAltSpecialReq"), "altJobRequirement", [YES]),
      ...specialRequirements("isAltSpecialReq", "isAltSpecReq", "altSpecReq"),
    ],
  },

  {
    navLabel: "Other Information",
    title: "F.d — Other Information",
    fields: [
      code("socCode", "F.d.1"),
      t("supervisorJobTitle"),
      radio("travelRequired"),
      area("travelDetails"),
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
      { name: "primaryWorksiteCounty", kind: "search", byId: true, widget: "react-select" },
      t("primaryWorksitePostalCode"),
      radio("otherWorksiteLocation"),
    ],
  },

  {
    navLabel: "Additional Worksites",
    title: "APX A — Additional Worksites",
    fields: [],
    conditional: true,
    marker: "Add Worksite",
    worksiteTable: {
      onlyWhen: { by: "otherWorksiteLocation", is: [YES] },
      addButtonText: "Add Worksite",
      saveButtonText: "Save",
      cityField: "add_values_field[0].worksiteCity",
      stateField: "add_values_field[0].worksiteState",
      countyField: "add_values_field[0].worksiteCountyTownship",
      basisRadio: "add_values_field[0]worksiteCountyOrBlsArea",
      basisValue: "County",
    },
  },

  {
    navLabel: "Application Documents",
    title: "Application Documents",
    fields: [],
    conditional: true,
    marker: "Add Document",
    documents: {
      addButtonText: "Add Document",
      saveButtonText: "Save",
      fileInputName: "application_documents",
      categoryName: "typeOfFile",
      category: "Other Supporting Documentation",
      maxBytes: 30 * 1024 * 1024,
      accept: [".pdf", ".png", ".jpg", ".jpeg"],
    },
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
  { match: "Add Data", reason: "Opens FLAG's quit box, which offers Delete Case." },
  { match: "Delete Case", reason: "Never." },
  { match: "Review & Submit", reason: "Read only; never submitted." },
];

export const ETA9141_NOT_AUTOFILLED: NotAutofilled[] = [];

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
  notAutofilled: ETA9141_NOT_AUTOFILLED,
  reviewNavLabel: "Review & Submit",
};
