// ===========================================================================
// I-130 STRUCTURAL DESCRIPTOR — page order, URL slugs, per-field kind, repeater
// flags, upload-only pages. Authored from paraleagle-dev/i130-online-field-dump.json
// (165 fields / 23 fillable sub-pages, captured live 2026-06-25, draft 12993840).
//
// This drives HOW to fill/navigate. It does NOT decide WHAT value a field gets
// or whether the data exists — the backend (form_myuscis_definitions.json) owns
// that, and emits {formik_name: value}. The fill-chain fills a page's fields by
// matching descriptor names against the backend payload. A name present here
// but absent from the payload is simply skipped (e.g. preparer fields, the
// `none` UI-meta toggles — all in the backend `skip` list).
//
// FieldKind notes:
//  - country / state inputs are MUI Autocomplete search inputs -> "search".
//  - phone intl-number inputs -> "phone".
//  - DOB / date fields are plain masked text on this form -> "text" (the
//    value-setter's masked-digit equality handles reformatting).
//  - radios use coded option values from the backend ("1","4","true"); the
//    value-setter clicks input[name][value]. The descriptor lists the option
//    values for documentation/tests, but the engine selects by the emitted value.
// ===========================================================================

import { FieldKind } from "../engine/types";

export interface DescriptorField {
  /** Formik `[name]` — matches the backend payload key exactly. */
  name: string;
  kind: FieldKind;
  /** Documented radio option codes (engine selects by the backend value). */
  options?: string[];
}

export interface RepeaterSpec {
  /**
   * Index-0 field-name prefix used to detect whether a row is rendered, e.g.
   * "applicant.yourAddressHistory". Rows use `${prefix}.${i}.<rest>`.
   */
  namePrefix: string;
  /**
   * Visible text on the "Add ..." button for this repeater (lower-cased
   * substring match). Clicking it renders the next indexed row.
   */
  addButtonText: string;
}

export type PageKind = "form" | "upload" | "review";

export interface FormPage {
  /** URL slug under the form base path. */
  slug: string;
  /** Human label (sidebar section / heading) for detection + logging. */
  title: string;
  kind: PageKind;
  /** Fillable fields, in DOM order. Empty for upload/review pages. */
  fields: DescriptorField[];
  /** Present when this page is a repeater (address/employment history etc.). */
  repeater?: RepeaterSpec;
  /**
   * Spouse-only / conditional page — only reachable when the relationship is
   * Spouse (or upstream answers are set). The chain tolerates these being
   * absent for non-spouse cases.
   */
  conditional?: boolean;
}

const t = (name: string): DescriptorField => ({ name, kind: "text" });
const search = (name: string): DescriptorField => ({ name, kind: "search" });
const phone = (name: string): DescriptorField => ({ name, kind: "phone" });
const radio = (name: string, options: string[]): DescriptorField => ({ name, kind: "radio", options });
const check = (name: string): DescriptorField => ({ name, kind: "checkbox" });
const area = (name: string): DescriptorField => ({ name, kind: "textarea" });

/**
 * The I-130 page walk, in order. The base path is
 *   https://my.uscis.gov/forms/petition-for-a-relative/<draftId>
 * and each `slug` is appended. The chain walks these in order via the form's
 * own Next button (never URL-hopping — respects the anti-deep-linking guard).
 */
export const I130_PAGES: FormPage[] = [
  // ── Getting Started ──────────────────────────────────────────────────────
  {
    slug: "/getting-started/preparer-and-interpreter-information",
    title: "Preparer and interpreter information",
    kind: "form",
    fields: [
      // UI-meta toggles — backend leaves these unmapped (in `skip`); the user
      // answers the helper question. Listed so the chain knows the page exists.
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper", ["true", "false"]),
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer", ["true", "false"]),
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter", ["true", "false"]),
    ],
  },

  // ── About You (PETITIONER on the online form — applicant.* names) ─────────
  {
    slug: "/about-you/your-name",
    title: "Your name",
    kind: "form",
    fields: [
      t("applicant.yourName.name.firstName"),
      t("applicant.yourName.name.middleName"),
      t("applicant.yourName.name.lastName"),
      radio("formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", ["true", "false"]),
    ],
  },
  {
    slug: "/about-you/your-contact-information",
    title: "Your contact information",
    kind: "form",
    fields: [
      phone("applicant.yourContactInformation.contactInformation.daytimePhoneNumber.intlNumber"),
      phone("applicant.yourContactInformation.contactInformation.mobilePhoneNumber.intlNumber"),
      t("applicant.yourContactInformation.contactInformation.emailAddress"),
      search("applicant.yourContactInformation.mailingAddress.country"),
      t("applicant.yourContactInformation.mailingAddress.addressLineOne"),
      t("applicant.yourContactInformation.mailingAddress.addressLineTwo"),
      t("applicant.yourContactInformation.mailingAddress.city"),
      search("applicant.yourContactInformation.mailingAddress.state"),
      t("applicant.yourContactInformation.mailingAddress.zipCode"),
      radio("applicant.yourContactInformation.isMailingEqualToPhysical", ["true", "false"]),
    ],
  },
  {
    slug: "/about-you/your-address-history",
    title: "Your address history",
    kind: "form",
    repeater: {
      namePrefix: "applicant.yourAddressHistory",
      addButtonText: "add address",
    },
    fields: [
      search("applicant.yourAddressHistory.{i}.address.country"),
      t("applicant.yourAddressHistory.{i}.address.addressLineOne"),
      t("applicant.yourAddressHistory.{i}.address.addressLineTwo"),
      t("applicant.yourAddressHistory.{i}.address.city"),
      search("applicant.yourAddressHistory.{i}.address.state"),
      t("applicant.yourAddressHistory.{i}.address.zipCode"),
      t("applicant.yourAddressHistory.{i}.dates.fromDate"),
      t("applicant.yourAddressHistory.{i}.dates.toDate"),
    ],
  },
  {
    slug: "/about-you/describe-yourself",
    title: "Describe yourself",
    kind: "form",
    fields: [
      radio("applicant.i130DescribeYourself.gender", ["3", "1"]),
      // Ethnicity is a single coded checkbox/radio (hispanic=1); race boxes
      // ("5","2","3","6","1") are unmapped by the backend (in `skip`).
      check("applicant.i130DescribeYourself.ethnicity"),
      t("applicant.i130DescribeYourself.height.feet"),
      t("applicant.i130DescribeYourself.height.inches"),
      t("applicant.i130DescribeYourself.weight"),
      t("applicant.i130DescribeYourself.eyeColor"),
      t("applicant.i130DescribeYourself.hairColor"),
    ],
  },
  {
    slug: "/about-you/your-employment-history",
    title: "Your employment history",
    kind: "form",
    repeater: {
      namePrefix: "applicant.employmentHistory",
      addButtonText: "add employer",
    },
    fields: [
      t("applicant.employmentHistory.{i}.name"),
      search("applicant.employmentHistory.{i}.address.country"),
      t("applicant.employmentHistory.{i}.address.addressLineOne"),
      t("applicant.employmentHistory.{i}.address.city"),
      search("applicant.employmentHistory.{i}.address.state"),
      t("applicant.employmentHistory.{i}.address.zipCode"),
      t("applicant.employmentHistory.{i}.occupation"),
      t("applicant.employmentHistory.{i}.dates.fromDate"),
      t("applicant.employmentHistory.{i}.dates.toDate"),
    ],
  },
  {
    slug: "/about-you/your-additional-information",
    title: "Your additional information",
    kind: "form",
    fields: [
      radio("applicant.additionalInformation.immigrationStatus", ["4", "11"]),
      radio("applicant.additionalInformation.gainedLPROrCitizenzhipThroughAdoption", ["true", "false"]),
      t("applicant.additionalInformation.alienNumber.number"),
      t("applicant.additionalInformation.uscisNumber.number"),
      t("applicant.additionalInformation.socialSecurityNumber.number"),
      t("applicant.additionalInformation.dateOfBirth"),
      search("applicant.additionalInformation.cityCountryNonUS.country"),
      t("applicant.additionalInformation.cityCountryNonUS.city"),
    ],
  },

  // ── Your Family (petitioner) ──────────────────────────────────────────────
  {
    slug: "/your-family/your-marital-status",
    title: "Your marital status",
    kind: "form",
    fields: [
      radio("applicant.maritalStatus.maritalStatus", ["1", "2", "3", "4", "7", "5"]),
    ],
  },
  {
    slug: "/your-family/your-parents/your-parents",
    title: "Your parents (1)",
    kind: "form",
    fields: [
      t("applicant.yourParentOne.name.firstName"),
      t("applicant.yourParentOne.name.middleName"),
      t("applicant.yourParentOne.name.lastName"),
      t("applicant.yourParentOne.dateOfBirth"),
      radio("applicant.yourParentOne.gender", ["3", "1"]),
      search("applicant.yourParentOne.countryOfBirth"),
      t("applicant.yourParentOne.cityOfResidence"),
      search("applicant.yourParentOne.countryOfResidence"),
    ],
  },
  {
    slug: "/your-family/your-parents/your-parents-page-2",
    title: "Your parents (2)",
    kind: "form",
    fields: [
      t("applicant.yourParentTwo.name.firstName"),
      t("applicant.yourParentTwo.name.middleName"),
      t("applicant.yourParentTwo.name.lastName"),
      t("applicant.yourParentTwo.dateOfBirth"),
      radio("applicant.yourParentTwo.gender", ["3", "1"]),
      search("applicant.yourParentTwo.countryOfBirth"),
      t("applicant.yourParentTwo.cityOfResidence"),
      search("applicant.yourParentTwo.countryOfResidence"),
    ],
  },

  // ── Your Beneficiary (the RELATIVE on the online form — beneficiary.* names) ─
  {
    slug: "/your-beneficiary/beneficiary-relationship",
    title: "Beneficiary relationship",
    kind: "form",
    fields: [
      radio("beneficiary.relationshipToBeneficiary.filingPetitionFor", ["1", "26", "27", "24"]),
      radio("beneficiary.relationshipToBeneficiary.hasPriorPetition", ["Yes", "No", "Unknown"]),
    ],
  },
  {
    slug: "/your-beneficiary/beneficiary-name",
    title: "Beneficiary name",
    kind: "form",
    fields: [
      t("beneficiary.beneficiaryName.name.firstName"),
      t("beneficiary.beneficiaryName.name.middleName"),
      t("beneficiary.beneficiaryName.name.lastName"),
      t("beneficiary.beneficiaryName.otherNames.0.firstName"),
      t("beneficiary.beneficiaryName.otherNames.0.middleName"),
      t("beneficiary.beneficiaryName.otherNames.0.lastName"),
    ],
  },
  {
    slug: "/your-beneficiary/beneficiary-contact-information",
    title: "Beneficiary contact information",
    kind: "form",
    fields: [
      phone("beneficiary.beneficiaryContactInformation.contactInformation.daytimePhoneNumber.intlNumber"),
      phone("beneficiary.beneficiaryContactInformation.contactInformation.mobilePhoneNumber.intlNumber"),
      t("beneficiary.beneficiaryContactInformation.contactInformation.emailAddress"),
    ],
  },
  {
    slug: "/your-beneficiary/beneficiary-addresses/beneficiary-addresses",
    title: "Beneficiary addresses",
    kind: "form",
    fields: [
      search("beneficiary.beneficiaryAddresses.physicalAddress.country"),
      t("beneficiary.beneficiaryAddresses.physicalAddress.addressLineOne"),
      t("beneficiary.beneficiaryAddresses.physicalAddress.addressLineTwo"),
      t("beneficiary.beneficiaryAddresses.physicalAddress.city"),
      search("beneficiary.beneficiaryAddresses.physicalAddress.state"),
      t("beneficiary.beneficiaryAddresses.physicalAddress.zipCode"),
    ],
  },
  {
    slug: "/your-beneficiary/beneficiary-addresses/beneficiary-address-lived-together",
    title: "Addresses you lived together",
    kind: "form",
    conditional: true,
    // SPOUSE-conditional repeater — the spike could not capture its field names
    // (deep-link redirected). Marked conditional; the chain tolerates 0 fields.
    fields: [],
  },
  {
    slug: "/your-beneficiary/beneficiary-additional-information",
    title: "Beneficiary additional information",
    kind: "form",
    fields: [
      t("beneficiary.additionalInformation.alienNumber.number"),
      t("beneficiary.additionalInformation.uscisNumber.number"),
      t("beneficiary.additionalInformation.socialSecurityNumber.number"),
      t("beneficiary.additionalInformation.dateOfBirth"),
      search("beneficiary.additionalInformation.cityCountryNonUS.country"),
      t("beneficiary.additionalInformation.cityCountryNonUS.city"),
      radio("beneficiary.additionalInformation.gender", ["3", "1"]),
    ],
  },
  {
    slug: "/your-beneficiary/immigration-information",
    title: "Immigration information",
    kind: "form",
    fields: [
      radio("beneficiary.immigrationInformation.hasBeenInUs", ["true", "false"]),
      t("beneficiary.immigrationInformation.passportOrTravelDocument.passportNumber"),
      t("beneficiary.immigrationInformation.passportOrTravelDocument.travelDocumentNumber"),
      search("beneficiary.immigrationInformation.passportOrTravelDocument.countryOfIssuance"),
      t("beneficiary.immigrationInformation.passportOrTravelDocument.expirationDate"),
      radio("beneficiary.immigrationInformation.hasBeenInImmigrationProceedings", ["true", "false"]),
    ],
  },
  {
    slug: "/your-beneficiary/beneficiary-employment-information",
    title: "Beneficiary employment information",
    kind: "form",
    fields: [
      t("beneficiary.beneficiaryEmploymentInformation.address.name"),
      search("beneficiary.beneficiaryEmploymentInformation.address.country"),
      t("beneficiary.beneficiaryEmploymentInformation.address.addressLineOne"),
      t("beneficiary.beneficiaryEmploymentInformation.address.addressLineTwo"),
      t("beneficiary.beneficiaryEmploymentInformation.address.city"),
      search("beneficiary.beneficiaryEmploymentInformation.address.state"),
      t("beneficiary.beneficiaryEmploymentInformation.address.zipCode"),
      t("beneficiary.beneficiaryEmploymentInformation.fromDate"),
    ],
  },

  // ── Beneficiary's Family ──────────────────────────────────────────────────
  // The dump captured only table-chrome inputs (displayDraftStatus / formType /
  // pagination) on marital-status, all in the backend `skip`. additional-family
  // is a conditional repeater with no captured fields.
  {
    slug: "/beneficiarys-family/beneficiarys-marital-status",
    title: "Beneficiary's marital status",
    kind: "form",
    fields: [],
  },
  {
    slug: "/beneficiarys-family/beneficiarys-additional-family",
    title: "Beneficiary's additional family",
    kind: "form",
    conditional: true,
    fields: [],
  },

  // ── Other Information ─────────────────────────────────────────────────────
  {
    slug: "/other-information/beneficiarys-adjustment-of-status",
    title: "Beneficiary's adjustment of status",
    kind: "form",
    fields: [
      t("otherInformation.adjustmentOfStatus.beneficiaryStatusAdjustInUs.city"),
      search("otherInformation.adjustmentOfStatus.beneficiaryStatusAdjustInUs.state"),
      search("otherInformation.adjustmentOfStatus.beneficiaryStatusAdjustOutsideUs.country"),
      t("otherInformation.adjustmentOfStatus.beneficiaryStatusAdjustOutsideUs.city"),
      t("otherInformation.adjustmentOfStatus.beneficiaryStatusAdjustOutsideUs.province"),
    ],
  },
  {
    slug: "/other-information/prior-petitions/prior-petitions",
    title: "Prior petitions",
    kind: "form",
    fields: [
      radio("otherInformation.priorPetitions.priorPetitions1.previouslyFiled", ["true", "false"]),
    ],
  },
  {
    slug: "/other-information/other-petitions",
    title: "Other petitions",
    kind: "form",
    repeater: {
      namePrefix: "otherInformation.otherPetitions",
      addButtonText: "add",
    },
    fields: [
      t("otherInformation.otherPetitions.{i}.relativeName.firstName"),
      t("otherInformation.otherPetitions.{i}.relativeName.middleName"),
      t("otherInformation.otherPetitions.{i}.relativeName.lastName"),
      t("otherInformation.otherPetitions.{i}.relativeRelationship"),
    ],
  },
  {
    slug: "/other-information/native-language",
    title: "Beneficiary name and address in native language",
    kind: "upload",
    fields: [],
  },

  // ── Evidence (uploads) ────────────────────────────────────────────────────
  {
    slug: "/evidences/i130a-supplimental-information-for-spouse-beneficiary",
    title: "I-130A supplemental information for spouse beneficiary",
    kind: "upload",
    conditional: true,
    fields: [],
  },
  {
    slug: "/evidences/proof-of-marriage",
    title: "Proof of marriage",
    kind: "upload",
    conditional: true,
    fields: [],
  },
  {
    slug: "/evidences/additional-proof-of-marriage",
    title: "Additional proof of marriage",
    kind: "upload",
    conditional: true,
    fields: [],
  },
  {
    slug: "/evidences/photo-of-you",
    title: "Photo of you",
    kind: "upload",
    conditional: true,
    fields: [],
  },
  {
    slug: "/evidences/photo-of-spouse",
    title: "Photo of spouse",
    kind: "upload",
    conditional: true,
    fields: [],
  },
  {
    slug: "/evidences/official-statement",
    title: "Official statement",
    kind: "upload",
    fields: [],
  },

  // ── Additional Information ────────────────────────────────────────────────
  {
    slug: "/additional-information/additional-information",
    title: "Additional information",
    kind: "form",
    repeater: {
      namePrefix: "additionalInformationTable",
      addButtonText: "add",
    },
    fields: [
      t("additionalInformationTable.{i}.section"),
      t("additionalInformationTable.{i}.page"),
      t("additionalInformationTable.{i}.question"),
      area("additionalInformationTable.{i}.response"),
    ],
  },

  // ── Review and Submit ─────────────────────────────────────────────────────
  {
    slug: "/review-and-submit/review-your-petition",
    title: "Review your petition",
    kind: "review",
    fields: [],
  },
];

/** Every distinct fillable field name the descriptor drives (index 0 for
 * repeaters), for coverage accounting against the backend payload. */
export function descriptorFieldNames(): string[] {
  const names = new Set<string>();
  for (const page of I130_PAGES) {
    for (const f of page.fields) {
      names.add(f.name.replace(/\{i\}/g, "0"));
    }
  }
  return [...names];
}
