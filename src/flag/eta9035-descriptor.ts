// ===========================================================================
// ETA-9035 — Labor Condition Application (H-1B LCA), on flag.dol.gov.
//
//   https://flag.dol.gov/dashboard/application/9035/<applicationId>
//
// AUTHORED FROM ONE LIVE CAPTURE, a throwaway draft read on 2026-10-08:
// `test/fixtures/flag-lca-field-dump/eta9035-capture.json`. Names, kinds, radio
// values and reveals all come from it. The backend sends values under the map's
// form code, ETA-9035E.
//
// Yes/No on THIS form is "YES"/"NO" (upper case). Not "1" as on the 9141 and not
// "Yes" as on the 9089.
//
// SECTION ORDER is the sidebar's own order. FIELD ORDER within a section is DOM
// order, except that a gate is listed before the fields it reveals.
// ===========================================================================

import { FlagField, FlagFormConfig, FlagSection, ForbiddenControl, NotAutofilled } from "./types";

const t = (name: string): FlagField => ({ name, kind: "text" });
const sel = (name: string): FlagField => ({ name, kind: "select" });
const phone = (name: string): FlagField => ({ name, kind: "phone" });
const radio = (name: string): FlagField => ({ name, kind: "radio" });
const box = (name: string): FlagField => ({ name, kind: "checkbox" });
/** A field revealed by an upstream answer. `is` carries FLAG's own option values. */
const when = (field: FlagField, by: string, is: string[]): FlagField => ({
  ...field,
  revealedBy: { by, is },
});

const YES = "YES";
const NO = "NO";
const PW_SOURCE = "_section_f_f12_f13_f14_prevailing_wage_question";
const OTHER_SURVEY = "Other/PW Survey";

export const ETA9035_SECTIONS: FlagSection[] = [
  {
    navLabel: "Employment-Based Nonimmigrant Visa Information",
    title: "A — Employment-Based Nonimmigrant Visa Information",
    fields: [radio("a1_visa_type")],
  },

  {
    navLabel: "Temporary Need Information",
    title: "B — Temporary Need Information",
    fields: [
      t("b1_job_title"),
      // No name and no id. Found by its printed label; `b2_soc_code` is only the
      // key the feed sends the code under. FLAG fills the B.3 title from the
      // option picked.
      {
        name: "b2_soc_code",
        kind: "search",
        byLabel: "B.2/B.3. SOC (ONET/OES) Code and Occupation Title",
      },
      radio("b4_is_full_time"),
      t("b5_begin_date"),
      t("b6_end_date"),
      t("b7_total_positions"),
      t("b7a_new_employment"),
      t("b7b_continuation"),
      t("b7c_change_approved"),
      t("b7d_new_concurrent"),
      t("b7e_change_employer"),
      t("b7f_amended_petition"),
    ],
  },

  {
    navLabel: "Employer Information",
    title: "C — Employer Information",
    fields: [
      t("c1_emp_name"),
      t("c2_emp_dba"),
      t("c12_emp_fein"),
      // Directly below the employer PROFILE PICKER. The label locate only takes
      // the one input in the label's own field, and the fill chain refuses it if
      // that input is the picker.
      { name: "c13_naics_code", kind: "search", byLabel: "C.13. NAICS Code" },
      t("c3_emp_address_1"),
      t("c4_emp_address_2"),
      // Country before state: FLAG filters the state list by country.
      sel("c8_emp_country_id"),
      t("c5_emp_city"),
      sel("c6_emp_state_id"),
      t("c7_emp_zip"),
      phone("c10_emp_phone"),
      t("c11_emp_phone_ext"),
    ],
  },

  {
    navLabel: "Employer Point of Contact Information",
    title: "D — Employer Point of Contact Information",
    fields: [
      t("d1_poc_last"),
      t("d2_poc_first"),
      t("d3_poc_middle"),
      t("d4_poc_title"),
      t("d5_poc_address_1"),
      t("d6_poc_address_2"),
      sel("d10_poc_country_id"),
      t("d7_poc_city"),
      sel("d8_poc_state_id"),
      t("d9_poc_zip"),
      phone("d12_poc_phone"),
      t("d13_poc_phone_ext"),
      t("d14_poc_email"),
    ],
  },

  {
    // The capture saw E.2-E.19 rendered with E.1 unanswered, so none is gated.
    navLabel: "Attorney or Agent Information",
    title: "E — Attorney or Agent Information",
    fields: [
      radio("e1_is_represented"),
      t("e2_agent_last"),
      t("e3_agent_first"),
      t("e4_agent_middle"),
      t("e5_agent_address_1"),
      t("e6_agent_address_2"),
      sel("e10_agent_country_id"),
      t("e7_agent_city"),
      sel("e8_agent_state_id"),
      t("e9_agent_zip"),
      phone("e12_agent_phone"),
      t("e13_agent_phone_ext"),
      t("e14_agent_email"),
      t("e15_agent_firm_name"),
      t("e16_agent_firm_fein"),
      t("e17_agent_bar_number"),
      sel("e18_agent_court_state_id"),
      t("e19_agent_court_name"),
    ],
  },

  {
    navLabel: "Employment and Wage Information",
    title: "F — Employment and Wage Information",
    fields: [
      // The source question gates F.13 and F.14. F.12a (PWD tracking number) is
      // filled through FLAG's "PWD Case Lookup" modal and the OES calculator
      // stays manual, so neither is here.
      radio(PW_SOURCE),
      when(radio("_section_f_f13a_wage_level"), PW_SOURCE, ["f13_is_oes_prevailing_wage"]),
      when(sel("_section_f_f13b_source_year"), PW_SOURCE, ["f13_is_oes_prevailing_wage"]),
      when(radio("_section_f_f14a_source_type"), PW_SOURCE, ["f14_non_oes_prevailing_wage"]),
      when(sel("_section_f_f14b_source_year_notcba"), "_section_f_f14a_source_type", [OTHER_SURVEY]),
      when(t("_section_f_f14c_survey_publisher"), "_section_f_f14a_source_type", [OTHER_SURVEY]),
      when(t("_section_f_f14d_survey_name"), "_section_f_f14a_source_type", [OTHER_SURVEY]),
      t("_section_f_f1_number_workers"),
      radio("_section_f_f2_is_secondary_entity"),
      when(t("_section_f_f3_secondary_entity_name"), "_section_f_f2_is_secondary_entity", [YES]),
      t("_section_f_f4_work_address_1"),
      t("_section_f_f5_work_address_2"),
      t("_section_f_f6_work_city"),
      sel("_section_f_f8_work_state_id"),
      // An id and no name. Driven as a search, as paraleagle-ext drives it.
      { name: "_section_f_f7_work_county_id", kind: "search", byId: true },
      t("_section_f_f9_work_zip"),
      t("_section_f_f10_nonimmigrant_wage_from"),
      t("_section_f_f10_nonimmigrant_wage_to"),
      radio("_section_f_f10a_nonimmigrant_wage_per"),
      t("_section_f_f11_prevailing_wage"),
      radio("_section_f_f11a_prevailing_wage_per"),
    ],
  },

  {
    navLabel: "Employer Labor Condition Statements",
    title: "G — Employer Labor Condition Statements",
    // G.1 is an attestation: refused below, listed so the section is recognised.
    fields: [radio("g1_read_agree")],
  },

  {
    navLabel: "H-1B Additional Employer Labor Condition Statements",
    title: "H — H-1B Additional Employer Labor Condition Statements",
    fields: [
      radio("h1_is_dependent"),
      radio("h2_is_willful_violator"),
      when(radio("h3_only_h1b"), "h1_is_dependent", [YES]),
      when(radio("h4_exemption_basis"), "h3_only_h1b", [YES]),
      when(radio("h5_is_appendix_a_completed"), "h3_only_h1b", [NO]),
      when(radio("h6_read_agree"), "h3_only_h1b", [NO]),
    ],
  },

  {
    navLabel: "Employer Obligations",
    title: "I/J — Employer Obligations",
    fields: [
      box("i1_is_disclosure_principal_business"),
      box("i1_is_disclosure_place_of_employment"),
      t("j1_official_last"),
      t("j2_official_first"),
      t("j3_official_middle"),
      t("j4_official_title"),
    ],
  },

  {
    navLabel: "LCA Preparer",
    title: "K — LCA Preparer",
    fields: [
      t("k1_prep_last"),
      t("k2_prep_first"),
      t("k3_prep_middle"),
      t("k4_prep_firm_name"),
      t("k5_prep_email"),
    ],
  },

  {
    navLabel: "Appendix A - Educational Attainment Documentation",
    title: "Appendix A — Educational Attainment Documentation",
    fields: [],
    conditional: true,
  },
];

/** Controls the runner must never touch. Enforced in the fill chain. */
export const ETA9035_FORBIDDEN: ForbiddenControl[] = [
  {
    match: "employer-9035",
    reason:
      "FLAG's employer profile picker. Selecting a profile repopulates all of " +
      "Section C from DOL's stored copy and would overwrite what we typed.",
  },
  {
    match: "employer-pocs-9035",
    reason: "FLAG's point-of-contact profile picker. Repopulates all of Section D.",
  },
  {
    match: "agent-attorney-individs-9035",
    reason: "FLAG's attorney profile picker. Repopulates all of Section E.",
  },
  {
    match: "Select an Employer profile",
    reason: "The profile pickers matched by their visible label as well as by id.",
  },
  { match: "PWD Case Lookup", reason: "F.12a lookup modal. Manual." },
  { match: "OES Wage Calculator", reason: "F.13 calculator modal. Manual by decision (2026-09-01)." },
  { match: "Review & Submit", reason: "Never." },
  {
    match: "g1_read_agree",
    reason: "G.1 is the employer agreeing to the labor condition statements. A person ticks it.",
  },
  {
    match: "h6_read_agree",
    reason: "H.6 is the employer agreeing to the additional statements. A person ticks it.",
  },
];

export const ETA9035_NOT_AUTOFILLED: NotAutofilled[] = [
  { box: "F.12a", label: "PWD tracking number", reason: "Use FLAG's PWD Case Lookup." },
  {
    box: "F.13",
    label: "OES Wage Calculator",
    reason: "Run the calculator yourself and check the wage it gives.",
  },
  { box: "G.1", label: "Labor condition statements", reason: "An attestation. Tick it yourself." },
  { box: "H.6", label: "Additional statements", reason: "An attestation. Tick it yourself, if shown." },
  {
    box: "Appendix A",
    label: "Educational attainment",
    reason: "Only for a dependent employer claiming the master's exemption.",
  },
];

export const ETA9035_CONFIG: FlagFormConfig = {
  formType: "ETA-9035E",
  urlPattern: /\/dashboard\/application\/9035\/[0-9a-f]+/,
  label: "ParaLeagle ETA-9035 (LCA)",
  // Exactly the backend's H1B_CASE_TYPES (forms/eta/maps.py). Anything else
  // gets a 400 from the feed.
  caseTypes: [
    "H-1B-COS-F1",
    "H-1B-COS-F2",
    "H-1B-COS-J2",
    "H-1B-COS-H4",
    "H-1B-COS-L2",
    "H-1B-COS-L1",
    "H-1B-CAP",
    "H-1B-CONSULAR",
    "H-1B-EXTENSION",
    "H-1B-TRANSFER",
    "H-1B-AMENDMENT",
    "H-1B-CONCURRENT",
    "H-1B-EXTENSION-AMENDMENT",
  ],
  sections: ETA9035_SECTIONS,
  forbidden: ETA9035_FORBIDDEN,
  notAutofilled: ETA9035_NOT_AUTOFILLED,
};
