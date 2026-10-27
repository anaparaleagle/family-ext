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

import {
  FlagField,
  FlagFormConfig,
  FlagModalSpec,
  FlagReveal,
  FlagSection,
  ForbiddenControl,
  NotAutofilled,
} from "./types";

const t = (name: string): FlagField => ({ name, kind: "text" });
const sel = (name: string): FlagField => ({ name, kind: "select" });
const phone = (name: string): FlagField => ({ name, kind: "phone" });
const radio = (name: string): FlagField => ({ name, kind: "radio" });
const box = (name: string): FlagField => ({ name, kind: "checkbox" });
/**
 * A masked money box. FLAG's wage boxes rewrite what is typed into them
 * ("110344" shows as "$110,344.00"), so they are written once and read back as
 * a number — see setCurrency. Filling one as plain text left $1.00 in F.10 on
 * a live run and reported it as a failure besides.
 */
const money = (name: string): FlagField => ({ name, kind: "currency" });
/** A field revealed by an upstream answer. `is` carries FLAG's own option values. */
const when = (field: FlagField, by: string, is: string[]): FlagField => ({
  ...field,
  revealedBy: { by, is },
});

/** A field revealed by ANY ONE of several answers — the form's own "and/or". */
const whenAny = (field: FlagField, gates: FlagReveal[]): FlagField => ({
  ...field,
  revealedBy: gates,
});

const YES = "YES";
const NO = "NO";
const PW_SOURCE = "_section_f_f12_f13_f14_prevailing_wage_question";
const OES_BRANCH = "f13_is_oes_prevailing_wage";
const OTHER_SURVEY = "Other/PW Survey";
const WAGE_FROM = "_section_f_f10_nonimmigrant_wage_from";
const WAGE_LEVEL = "_section_f_f13a_wage_level";
const WAGE_PER = "_section_f_f10a_nonimmigrant_wage_per";

/**
 * FLAG's OES Wage Calculator, as the H-1B extension drove it for years
 * (paraleagle-ext, src/content/lca-filler.ts `fillSectionF` and the `F_OES`
 * block of src/mappings/lca-field-map.ts).
 *
 * This was previously listed as "manual by decision (2026-09-01)". That
 * decision predates reading the old path end to end, and it is what left
 * Section F uncommittable: picking F.13 DISABLES F.7, F.11, F.11a, F.13a and
 * F.13b, so the fill could neither type them nor obtain them, "Add Place of
 * Employment" stayed greyed on "Wage Level: This field is required", and the
 * section saved with no rows.
 *
 * THE SELECTORS ARE THE OLD EXTENSION'S, AND THEY MAY HAVE AGED. Its own
 * comment records that DOL redesigned this modal once already. Everything here
 * therefore degrades to a reported miss rather than a silent wrong wage: a
 * field that is not in the dialog is reported, and a calculator that returns
 * no prevailing wage says so in the toolbar. It is still submitted in that
 * case, exactly as the old flow submitted it — the modal sits OVER the rest of
 * Section F, so leaving it open would cost every box below it and the worksite
 * row with them. The boxes it owns stay untyped either way.
 *
 * THREE CHOICES ARE OURS, NOT THE CASE'S, and the toolbar says so. The old
 * system carried them as backend fields (OES_collection_type, OES_area_based,
 * OES_rd_flag) that in practice held these same answers; no question in the
 * family questionnaire asks them, so inventing a backend field to hold a
 * constant would only hide where the answer comes from.
 */
export const OES_WAGE_CALCULATOR: FlagModalSpec = {
  openButton: "OES Wage Calculator",
  onlyWhen: { by: PW_SOURCE, is: [OES_BRANCH] },
  calculateButton: "Calculate",
  resultField: "OES_prevailing_wage",
  submitButton: "Submit",
  fields: [
    // The state and the county are the worksite's, already coded to FLAG's own
    // spelling by the feed (an uppercase full state name).
    { name: "OES_state", kind: "select", byId: true, from: "_section_f_f8_work_state_id" },
    { name: "OES_collection_type", kind: "radio", constant: "All Industries" },
    { name: "OES_area_based", kind: "radio", constant: "County/Township" },
    // Paused before, as the old flow paused: its option list is rebuilt off
    // the state and the area basis answered above it.
    {
      name: "OES_area",
      kind: "search",
      byId: true,
      from: "_section_f_f7_work_county_id",
      waitBefore: true,
    },
    { name: "OES_rd_flag", kind: "radio", constant: "No" },
    // Both only become answerable once Calculate has a wage to apply them to.
    { name: "OES_wage_level", kind: "select", byId: true, from: WAGE_LEVEL, afterCalculate: true },
    // SOF-643, settled with Sruthi on the old portal and carried here verbatim:
    // the calculator's per-unit must match the OFFERED wage's unit (F.10a), NOT
    // the stored prevailing-wage unit. Set to Year against an hourly offer, the
    // calculator returns an ANNUAL prevailing wage and locks F.10a/F.11a to
    // Year — so "$43/hr" is then read as "$43/yr", below the state minimum.
    { name: "OES_per", kind: "select", byId: true, from: WAGE_PER, afterCalculate: true },
  ],
  owns: [
    "_section_f_f7_work_county_id",
    "_section_f_f11_prevailing_wage",
    "_section_f_f11a_prevailing_wage_per",
    WAGE_LEVEL,
    "_section_f_f13b_source_year",
  ],
};

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
    // Section F is ONE ROW of a table, not a section of boxes. FLAG prints the
    // warning itself: "If you navigate away from this page without clicking the
    // 'Add Place of Employment' button, your changes will be lost."
    repeater: {
      addButtonText: "Add Place of Employment",
      entriesLabel: "Entries for Place of Employment",
      // One row's worth of boxes. F.7 is in the list even though the OES
      // calculator owns it, because it is the calculator's AREA input and a
      // second worksite in another county must re-run it with that county.
      rowFields: [
        "_section_f_f4_work_address_1",
        "_section_f_f5_work_address_2",
        "_section_f_f6_work_city",
        "_section_f_f7_work_county_id",
        "_section_f_f8_work_state_id",
        "_section_f_f9_work_zip",
      ],
    },
    modal: OES_WAGE_CALCULATOR,
    fields: [
      // The source question gates F.13, F.14 and the OES Wage Calculator.
      // F.12a (PWD tracking number) is filled through FLAG's "PWD Case Lookup"
      // modal, which this does not drive, so it is not here.
      radio(PW_SOURCE),
      when(radio(WAGE_LEVEL), PW_SOURCE, [OES_BRANCH]),
      when(sel("_section_f_f13b_source_year"), PW_SOURCE, [OES_BRANCH]),
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
      money(WAGE_FROM),
      // F.10 is a RANGE, and FLAG enforces it: "The 'To' must be higher than
      // the 'From' wage rate". Our feed sends the case's salary max, which on a
      // single-rate offer comes back equal to the min — typing it leaves that
      // error standing and "Add Place of Employment" greyed out, so the whole
      // worksite row is lost over a box that was never a range.
      { ...money("_section_f_f10_nonimmigrant_wage_to"), onlyAbove: WAGE_FROM },
      // Re-checked after the whole section is typed, exactly as the old
      // extension's step 7b did. FLAG defaults the offered-wage unit to Year,
      // and entering a wage amount after the unit can reset it — which turns
      // "$43 / Hour" into "$43 / Year" and has FLAG refuse it as below the
      // state minimum. ONLY this one: F.11a is the calculator's and must not
      // be re-asserted, or the annual/hourly mismatch comes straight back.
      { ...radio(WAGE_PER), reassert: true },
      money("_section_f_f11_prevailing_wage"),
      radio("_section_f_f11a_prevailing_wage_per"),
    ],
  },

  {
    navLabel: "Employer Labor Condition Statements",
    title: "G — Employer Labor Condition Statements",
    // G.1 is the agreement every LCA carries, and FLAG will not save the
    // section while it is blank. The old H-1B extension filled it
    // (paraleagle-ext, lca-field-map `G1_agree`); this one refused it as an
    // attestation and left a required radio reading "This field is required"
    // with one filable answer. It is driven again, on the backend's value.
    fields: [radio("g1_read_agree")],
  },

  {
    navLabel: "H-1B Additional Employer Labor Condition Statements",
    title: "H — H-1B Additional Employer Labor Condition Statements",
    fields: [
      radio("h1_is_dependent"),
      radio("h2_is_willful_violator"),
      // "If Yes to H.1 AND/OR H.2" — the form's own wording, and the backend
      // derives H.3 on exactly that rule. The capture only ever toggled H.1, so
      // it recorded the one gate it saw; taking that literally hid H.3 from a
      // willful violator that is not H-1B dependent, which is a REQUIRED box
      // left blank and a section FLAG then refuses to save. H.2 only became
      // answerable at all when the employer record gained the question
      // (SOF-2300), which is why nothing caught this before.
      whenAny(radio("h3_only_h1b"), [
        { by: "h1_is_dependent", is: [YES] },
        {
          by: "h2_is_willful_violator",
          is: [YES],
          source:
            "Observed live on a 9035 draft, 2026-10-24 (tools/flag-h3-probe.js): " +
            "H.1 No + H.2 Yes renders H.3, and FLAG marks it required. Not in " +
            "the 2026-10-08 capture, which only ever toggled H.1.",
        },
      ]),
      when(radio("h4_exemption_basis"), "h3_only_h1b", [YES]),
      // H.5's real condition is H.1 Yes AND H.3 No, read live on 2026-10-24:
      // with H.1 No it is absent on every H.4 basis, and it appears the moment
      // H.1 flips to Yes. That is an AND, and `revealedBy` only expresses OR —
      // several gates, any one of which is enough.
      //
      // Left as the capture recorded it rather than widened, because the
      // difference cannot bite today: the backend never emits a value for H.5
      // (H.3 always derives Yes, so this branch is unreachable from our feed),
      // and a field with no value is skipped before any gate is read. If
      // something ever does send H.5, this needs AND support — for a
      // non-dependent employer the OR reading would wait out the reveal timeout
      // and report a broken reveal that is really just a box doing as it should.
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
  // "OES Wage Calculator" was here, refused as manual by a decision of
  // 2026-09-01. REVERSED on 2026-10-27 after reading the H-1B extension's
  // Section F path: the calculator is not an optional convenience, it is the
  // only way F.11 and F.13a can be answered at all once F.12/13/14 says OES,
  // and without it Section F has no committable row. It is now driven, by
  // OES_WAGE_CALCULATOR above. Nothing else moved: the modal is never
  // submitted unless it produced a wage, and the application's own
  // "Review & Submit" stays refused below.
  { match: "Review & Submit", reason: "Never." },
  // "g1_read_agree" was refused here. Reversed on 2026-10-28: G.1 is the one
  // agreement every LCA carries, No is not a filable answer, and the old H-1B
  // portal always set it. See the Section G comment above.
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
    reason:
      "Driven for you on All Industries / County-Township / R&D No. " +
      "Check the prevailing wage it returns before you file.",
  },
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
    // Every H-1B petition needs an LCA, including a case filed under the plain
    // code. Leaving it out hid those cases from the picker with no error — the
    // list simply came back empty and read as the extension being broken.
    "H-1B",
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
