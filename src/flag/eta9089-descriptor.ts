// ETA-9089 on flag.dol.gov: https://flag.dol.gov/dashboard/application/9089/<applicationId>
// Authored from the live walk of 2026-11-12 (perm-9141-test-kit-2026-11-11/FLAG-9089-what-to-build.md).
// Section order is the sidebar's; a gate is listed before the fields it reveals.

import { FlagField, FlagFormConfig, FlagSection, NotAutofilled } from "./types";

const t = (name: string): FlagField => ({ name, kind: "text" });
const area = (name: string): FlagField => ({ name, kind: "textarea" });
const sel = (name: string): FlagField => ({ name, kind: "select" });
const money = (name: string): FlagField => ({ name, kind: "currency" });
const date = (name: string): FlagField => ({ name, kind: "date" });
const phone = (name: string): FlagField => ({ name, kind: "phone", widget: "typed-phone" });
const radio = (name: string): FlagField => ({ name, kind: "radio", widget: "label-click" });
const box = (name: string): FlagField => ({ name, kind: "checkbox", widget: "label-click" });
const when = (field: FlagField, by: string, is: string[]): FlagField => ({ ...field, revealedBy: { by, is } });

const TICKED = "true";
const atty = (field: FlagField): FlagField => when(field, "attyAgRepType", ["Attorney", "Agent"]);
const row = (name: string): string => `add_values_field[0].${name}`;

const RECRUITMENT_STEPS = [
  "jobFair", "employerWebsite", "jobSearchWebsite", "onCampusRecruiting", "tradeProfessional",
  "privateEmployment", "employeeReferral", "campusPlacement", "localEthnicNewspaper", "radioTvAd",
];

export const ETA9089_SECTIONS: FlagSection[] = [
  {
    navLabel: "Preliminary Questions",
    title: "Preliminary",
    fields: [radio("occupationType"), radio("supervisedRecruitment")],
  },
  {
    navLabel: "Employer Information",
    title: "A — Employer Information",
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
      { name: "naicsCode", kind: "search", widget: "autosuggest", boxPrefix: "A.13" },
      t("empNumPayroll"),
      t("empYearCommenced"),
      radio("empWorkerInterest"),
      radio("empRelationshipWorker"),
    ],
  },
  {
    navLabel: "Employer Point-of-Contact Information",
    title: "B — Employer Point of Contact",
    fields: [
      t("empPocLastName"),
      t("empPocFirstName"),
      t("empPocMiddleName"),
      t("empPocJobTitle"),
      t("empPocAddr1"),
      t("empPocAddr2"),
      sel("empPocCountry"),
      t("empPocCity"),
      sel("empPocState"),
      t("empPocPostalCode"),
      t("empPocProvince"),
      phone("empPocPhone"),
      t("empPocPhoneExt"),
      t("empPocEmail"),
    ],
  },
  {
    navLabel: "Attorney or Agent Information",
    title: "C — Attorney or Agent",
    fields: [
      radio("attyAgRepType"),
      atty(t("attyAgLastName")),
      atty(t("attyAgFirstName")),
      atty(t("attyAgMiddleName")),
      atty(t("attyAgAddress1")),
      atty(t("attyAgAddress2")),
      atty(sel("attyAgCountry")),
      atty(t("attyAgCity")),
      atty(sel("attyAgState")),
      atty(t("attyAgPostalCode")),
      atty(phone("attyAgPhone")),
      atty(t("attyAgPhoneExt")),
      atty(t("attyAgEmail")),
      atty(t("attyAgLawFirmName")),
      atty(t("attyAgFEIN")),
      atty(t("attyAgStateBarNumber")),
      atty(sel("attyAgGoodStandingState")),
      atty(t("attyAgGoodStandingAttorney")),
    ],
  },
  {
    navLabel: "Foreign Worker Information",
    title: "D — Foreign Worker",
    fields: [radio("fwInfoAttyorAgent")],
  },
  {
    navLabel: "Job Opportunity and Wage Information",
    title: "E — Job Opportunity and Wage",
    fields: [money("jobOppWageFrom"), money("jobOppWageTo"), radio("jobOppWagePer"), area("jobOppWageConditions")],
  },
  {
    navLabel: "Worksite Information",
    title: "F.a — Worksite",
    fields: [
      radio("primaryWorksiteType"),
      t("primaryWorksiteAddr1"),
      t("primaryWorksiteAddr2"),
      t("primaryWorksiteCity"),
      sel("primaryWorksiteState"),
      { name: "primaryWorksiteCounty", kind: "search", byId: true, widget: "react-select" },
      t("primaryWorksitePostalCode"),
    ],
  },
  {
    navLabel: "Additional Worksites",
    title: "F.b — Additional Worksites",
    fields: [radio("isMultipleLocations")],
  },
  {
    navLabel: "Other Definable Geographic Area",
    title: "F.c — Other Geographic Area",
    fields: [area("geograpicalArea")],
  },
  {
    navLabel: "Additional Job Opportunity Information",
    title: "G — Other Job Information",
    fields: [
      "isFullTimeEmp", "isLiveInHousehold", "isPaidExperience", "isFwexecutedCont", "isEmpProvidedCont",
      "acceptDiplomaPwd", "isFwCurrentlyWrk", "isFwQualify", "empWillAccept", "empRelyExp", "fwGainExp",
      "empPayEducation", "jobEmpPremises", "jobComboOccup", "jobForeignLanguage", "jobReqExceed",
      "empUseCredential", "emprecpayment", "emPlayoff",
    ].map(radio),
  },
  {
    navLabel: "Professional/Non-Professional Recruitment Information",
    title: "H.c — Recruitment",
    conditional: true,
    fields: [
      date("swaJobOrderStartDate"),
      date("swaJobOrderEndDate"),
      radio("sundayPaperExists"),
      t("newspaperNameForAd"),
      date("newspaperAdPlacedDate"),
      radio("advertisementMethod"),
      t("journalNameForAd"),
      date("journalAdPlacedDate"),
    ],
  },
  {
    navLabel: "Additional Recruitment Requirements for Professional Occupations",
    title: "H.d — Additional Recruitment",
    conditional: true,
    fields: RECRUITMENT_STEPS.flatMap((step) => [
      box(`${step}Included`),
      when(date(`${step}From`), `${step}Included`, [TICKED]),
      when(date(`${step}To`), `${step}Included`, [TICKED]),
    ]),
  },
  {
    navLabel: "Notice of Posting",
    title: "H.e — Notice of Posting",
    fields: [
      box("bargainingRep"),
      box("noBargainingRepPhysical"),
      when(box("noBargainingRepElectronic"), "noBargainingRepPhysical", [TICKED]),
      when(box("noBargainingRepInHouse"), "noBargainingRepPhysical", [TICKED]),
      box("noBargainingRepPrivate"),
      box("noBargainingRepNoNotice"),
    ],
  },
  {
    navLabel: "Preparer",
    title: "J — Preparer",
    fields: [
      t("prepLastName"),
      t("prepfirstName"),
      t("prepMiddleName"),
      t("prepLawFirmFEIN"),
      t("prepFirmBusinessName"),
      t("prepEmail"),
    ],
  },
  {
    navLabel: "Foreign Worker Contact Information",
    title: "APX A.A — Foreign Worker Contact",
    fields: [
      t("appAContLastName"),
      t("appAContFirstName"),
      t("appAContMiddleName"),
      t("appAContAddress1"),
      t("appAContAddress2"),
      sel("appAContCountryId"),
      t("appAContCity"),
      sel("appAContStateId"),
      t("appAContPostalCode"),
      t("appAContProvince"),
      date("appAContDOB"),
      sel("appAContAdmClassId"),
      t("appAContAlienReg"),
      sel("appAContBirthCountryId"),
      sel("appAContCitizenCountryId"),
    ],
  },
  {
    navLabel: "Foreign Worker Education",
    title: "APX A.B — Education",
    fields: [],
    conditional: true,
    addRows: {
      rowsKey: "education",
      addText: "+ Add Foreign Worker Education",
      saveText: "Save",
      labelField: row("appAEduInstName"),
      fields: [
        radio("add_values_field[0]appAEduTypeId"),
        t(row("appAEduOther")),
        t(row("appAEduMajors")),
        t(row("appAEduInstName")),
        sel(row("appAEduCountryId")),
        t(row("appAEduMonthYearAttained")),
      ],
    },
  },
  {
    navLabel: "Foreign Worker Training Qualifications",
    title: "APX A.C — Training",
    fields: [],
    conditional: true,
    addRows: {
      rowsKey: "training",
      addText: "+ Add Foreign Worker Training",
      saveText: "Save",
      labelField: row("appATrainingInstName"),
      fields: [
        t(row("appATrainingInstName")),
        t(row("appATrainingName")),
        t(row("appATrainingCert")),
        t(row("appATrainingStartDate")),
        t(row("appATrainingEndDate")),
        t(row("appATrainingYearAwd")),
      ],
    },
  },
  {
    navLabel: "Foreign Worker Skills",
    title: "APX A.D — Skills",
    fields: [],
    conditional: true,
    addRows: {
      rowsKey: "skills",
      addText: "+ Add Skills, Abilities, and Proficiencies",
      saveText: "Save",
      labelField: row("appASkillsInstName"),
      fields: [
        t(row("appASkillsInstName")),
        sel(row("appASkillsCountryId")),
        sel(row("appASkillsStateId")),
        area(row("appASkillsSpecial")),
      ],
    },
  },
  {
    navLabel: "Foreign Worker Work Experience",
    title: "APX A.E — Work Experience",
    fields: [],
    conditional: true,
    addRows: {
      rowsKey: "experience",
      addText: "+ Add Foreign Worker Work Experience",
      saveText: "Save",
      labelField: row("appAExpEmpName"),
      fields: [
        t(row("appAExpEmpName")),
        t(row("appAExpAddress1")),
        t(row("appAExpAddress2")),
        t(row("appAExpCity")),
        t(row("appAExpPostalCode")),
        sel(row("appAExpCountryId")),
        sel(row("appAExpStateTerritory")),
        t(row("appAExpJobTitle")),
        t(row("appAExpStartDate")),
        t(row("appAExpEndDate")),
        radio("add_values_field[0]appAExpFWPresent"),
        t(row("appAExpWorkHour")),
        area(row("appAExpJobDuties")),
      ],
    },
  },
  {
    navLabel: "Appendix B",
    title: "APX B — Additional Worksites",
    fields: [],
    conditional: true,
    pickRows: {
      onlyWhen: { by: "isMultipleLocations", is: ["Yes"] },
      addButtonText: "Add Worksites",
      saveTexts: ["Save", "Add Selected", "Select", "Done", "OK"],
    },
  },
  {
    navLabel: "Supplemental Information",
    title: "APX C — Supplemental Information",
    fields: [],
    conditional: true,
    addRows: {
      rowsKey: "supplemental",
      saveText: "Save",
      labelField: "sectionAndItemNum",
      addText: "+ Add Supplemental Information",
      fields: [
        sel("sectionAndItemNum"),
        {
          ...sel("sectionName"),
          optionFor: {
            from: "sectionAndItemNum",
            keywords: {
              "G.6": "premises",
              "G.7": "combination",
              "G.8": "foreign language",
              "G.9": "svp",
              "G.10": "credential",
              "G.11": "payment",
              "G.12": "layoff",
            },
          },
        },
        area("suppInfo"),
      ],
    },
  },
  {
    navLabel: "Application Documents",
    title: "Application Documents",
    fields: [],
    conditional: true,
  },
];

export const ETA9089_FORBIDDEN = [
  { match: "employer-9089", reason: "FLAG's employer profile picker repopulates all of Section A." },
  { match: "employer-pocs-9089", reason: "FLAG's point-of-contact profile picker repopulates Section B." },
  { match: "agent-attorney-individs-9089", reason: "FLAG's attorney profile picker repopulates Section C." },
  { match: "groupSelect", reason: "Appendix A.A profile picker." },
  { match: "fwSelect", reason: "Appendix A.A profile picker." },
  { match: "Select an Employer profile", reason: "The profile pickers, matched by their visible label." },
  { match: "sectionIAgreement", reason: "I.1 is the employer's certification under penalty of perjury." },
  { match: "jobOppPWDNumber", reason: "FLAG fills E.1 from the determined 9141 and locks it." },
  { match: "Add Data", reason: "Opens FLAG's quit box, which offers Delete Case." },
  { match: "Delete Case", reason: "Never." },
  { match: "Review & Submit", reason: "Read only; never submitted." },
];

export const ETA9089_NOT_AUTOFILLED: NotAutofilled[] = [
  { box: "I.1", label: "Employer certification", reason: "a certification under penalty of perjury; the employer ticks it" },
  { box: "E.1", label: "PWD case number", reason: "FLAG fills it when the 9089 is started from the determined 9141" },
];

export const ETA9089_CONFIG: FlagFormConfig = {
  formType: "ETA-9089",
  urlPattern: /\/dashboard\/application\/9089\//,
  label: "ParaLeagle ETA-9089",
  caseTypes: ["PERM"],
  sections: ETA9089_SECTIONS,
  forbidden: ETA9089_FORBIDDEN,
  notAutofilled: ETA9089_NOT_AUTOFILLED,
  reviewNavLabel: "Review & Submit",
};
