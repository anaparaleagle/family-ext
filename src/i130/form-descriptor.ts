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

// The descriptor types + authoring helpers are shared with every other guided
// online form (see src/runner/types.ts); only the page table below is I-130.
import { FormPage, area, check, fieldNamesOf, phone, radio, search, t } from "../runner/types";

export type { DescriptorField, FormPage, PageKind, RepeaterSpec } from "../runner/types";

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
    // P10 (captured 2026-06-29): "other names used = Yes" reveals an indexed
    // other-name repeater (row 0 renders automatically; "add another name" adds
    // rows 1+). The hasAdditionalNames toggle stays UI-meta (backend `skip`).
    repeater: {
      namePrefix: "applicant.yourName.additionalNames.otherNames",
      addButtonText: "add another name",
    },
    fields: [
      t("applicant.yourName.name.firstName"),
      t("applicant.yourName.name.middleName"),
      t("applicant.yourName.name.lastName"),
      radio("formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", ["true", "false"]),
      t("applicant.yourName.additionalNames.otherNames.{i}.firstName"),
      t("applicant.yourName.additionalNames.otherNames.{i}.middleName"),
      t("applicant.yourName.additionalNames.otherNames.{i}.lastName"),
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
      // P3 (captured 2026-06-29): prior-spouse COUNT. >=1 reveals the prior-
      // marriages page; =Married reveals the current-spouse page. Backend leaves
      // this unmapped (in `skip`) — our facts hold total times_married, not the
      // online "previous spouses" count; the count is a backend follow-up.
      t("applicant.maritalStatus.previousSpouses"),
    ],
  },
  {
    // P3 (captured 2026-06-29): shown when applicant.maritalStatus.maritalStatus
    // = 2 (Married). The petitioner's current spouse + marriage details.
    slug: "/your-family/your-current-spouse",
    title: "Current spouse",
    kind: "form",
    conditional: true,
    fields: [
      t("applicant.currentSpouse.name.firstName"),
      t("applicant.currentSpouse.name.middleName"),
      t("applicant.currentSpouse.name.lastName"),
      t("applicant.currentSpouse.marriageDate"),
      search("applicant.currentSpouse.marriageLocation.country"),
      t("applicant.currentSpouse.marriageLocation.city"),
      search("applicant.currentSpouse.marriageLocation.state"),
      t("applicant.currentSpouse.dateMarriageEnded"),
    ],
  },
  {
    // P3 (captured 2026-06-29): shown when previousSpouses >= 1 — REPEATER of the
    // petitioner's prior marriages.
    slug: "/your-family/your-prior-marriages",
    title: "Prior marriages",
    kind: "form",
    conditional: true,
    repeater: {
      namePrefix: "applicant.priorMarriages",
      addButtonText: "add another marriage",
    },
    fields: [
      t("applicant.priorMarriages.{i}.name.firstName"),
      t("applicant.priorMarriages.{i}.name.middleName"),
      t("applicant.priorMarriages.{i}.name.lastName"),
      t("applicant.priorMarriages.{i}.dateMarriageEnded"),
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
      // BONUS (captured 2026-06-29): conditional reveals for an intended US
      // address / a foreign address -> applicant.intended_us_address /
      // applicant.foreign_address. Skipped by the value-setter when not rendered.
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressInUs.addressLineOne"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressInUs.addressLineTwo"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressInUs.city"),
      search("beneficiary.beneficiaryAddresses.otherPhysicalAddressInUs.state"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressInUs.zipCode"),
      search("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.country"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.addressLineOne"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.addressLineTwo"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.city"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.province"),
      t("beneficiary.beneficiaryAddresses.otherPhysicalAddressOutsideUs.postalCode"),
    ],
  },
  {
    // P5 (captured 2026-06-29): shown when relationship filingPetitionFor = 1
    // (Spouse) -> applicant.last_address_lived_together. SINGLE block (not indexed).
    slug: "/your-beneficiary/beneficiary-addresses/beneficiary-address-lived-together",
    title: "Addresses you lived together",
    kind: "form",
    conditional: true,
    fields: [
      search("beneficiary.beneficiaryAddressLivedTogether.address.country"),
      t("beneficiary.beneficiaryAddressLivedTogether.address.addressLineOne"),
      t("beneficiary.beneficiaryAddressLivedTogether.address.addressLineTwo"),
      t("beneficiary.beneficiaryAddressLivedTogether.address.city"),
      search("beneficiary.beneficiaryAddressLivedTogether.address.state"),
      t("beneficiary.beneficiaryAddressLivedTogether.address.zipCode"),
      t("beneficiary.beneficiaryAddressLivedTogether.dates.fromDate"),
      t("beneficiary.beneficiaryAddressLivedTogether.dates.toDate"),
    ],
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
    // P7 (captured 2026-06-29): shown when
    // beneficiary.immigrationInformation.hasBeenInImmigrationProceedings = true.
    // Proceeding type/location/date. State input is unmapped by the backend (our
    // applicant.proceedings_location is a single text field, mapped to the city).
    slug: "/your-beneficiary/beneficiary-immigration-proceedings",
    title: "Immigration proceedings",
    kind: "form",
    conditional: true,
    fields: [
      radio("beneficiary.immigrationProceeding.bnftProceedingType", ["1", "3", "4", "8"]),
      t("beneficiary.immigrationProceeding.bnftProceedingLocation.city"),
      search("beneficiary.immigrationProceeding.bnftProceedingLocation.state"),
      t("beneficiary.immigrationProceeding.bnftExpirationDate"),
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
    // P4 (captured 2026-06-29): beneficiary marital status + prior-spouse count.
    // previousSpouses is unmapped by the backend (in `skip`) — same total-vs-prior
    // count caveat as the petitioner side.
    slug: "/beneficiarys-family/beneficiarys-marital-status",
    title: "Beneficiary's marital status",
    kind: "form",
    fields: [
      radio("beneficiary.maritalStatus.maritalStatus", ["1", "2", "3", "4", "7", "5"]),
      t("beneficiary.maritalStatus.previousSpouses"),
    ],
  },
  {
    // P4 (captured 2026-06-29): shown when beneficiary.maritalStatus.maritalStatus
    // = 2. Only the name maps (-> applicant.current_spouse); the marriage detail
    // fields have no backing fact (applicant.current_marriage.* does not exist).
    slug: "/beneficiarys-family/beneficiarys-current-spouse",
    title: "Beneficiary's current spouse",
    kind: "form",
    conditional: true,
    fields: [
      t("beneficiary.currentSpouse.name.firstName"),
      t("beneficiary.currentSpouse.name.middleName"),
      t("beneficiary.currentSpouse.name.lastName"),
      t("beneficiary.currentSpouse.marriageDate"),
      search("beneficiary.currentSpouse.marriageLocation.country"),
      t("beneficiary.currentSpouse.marriageLocation.city"),
      search("beneficiary.currentSpouse.marriageLocation.state"),
      t("beneficiary.currentSpouse.dateMarriageEnded"),
    ],
  },
  {
    // P4 (captured 2026-06-29): shown when previousSpouses >= 1 — REPEATER of the
    // beneficiary's prior spouses -> applicant.prior_marriages. NOTE the online
    // name prefix is beneficiary.previousSpouses (not priorMarriages).
    slug: "/beneficiarys-family/beneficiarys-prior-marriages",
    title: "Prior spouses",
    kind: "form",
    conditional: true,
    repeater: {
      namePrefix: "beneficiary.previousSpouses",
      addButtonText: "add another spouse",
    },
    fields: [
      t("beneficiary.previousSpouses.{i}.name.firstName"),
      t("beneficiary.previousSpouses.{i}.name.middleName"),
      t("beneficiary.previousSpouses.{i}.name.lastName"),
      t("beneficiary.previousSpouses.{i}.dateMarriageEnded"),
    ],
  },
  {
    // P4 (captured 2026-06-29): REPEATER of the beneficiary's additional family
    // members. The backend does NOT map this yet — there is no
    // applicant.additional_family list fact (flagged as a vocab gap), so the
    // resolver emits no rows until that fact key is added.
    slug: "/beneficiarys-family/beneficiarys-additional-family",
    title: "Beneficiary's additional family",
    kind: "form",
    conditional: true,
    repeater: {
      namePrefix: "beneficiary.additionalFamily",
      addButtonText: "add another family member",
    },
    fields: [
      t("beneficiary.additionalFamily.{i}.name.firstName"),
      t("beneficiary.additionalFamily.{i}.name.middleName"),
      t("beneficiary.additionalFamily.{i}.name.lastName"),
      radio("beneficiary.additionalFamily.{i}.relationship", ["1", "24"]),
      t("beneficiary.additionalFamily.{i}.dateOfBirth"),
      search("beneficiary.additionalFamily.{i}.country"),
    ],
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
    // P8 (captured 2026-06-29): shown when
    // otherInformation.priorPetitions.priorPetitions1.previouslyFiled = true.
    // SINGLE detail block (not indexed) -> petitioner.prior_petitions[0].
    slug: "/other-information/prior-petitions/prior-petitions-page-2",
    title: "Prior petitions page 2",
    kind: "form",
    conditional: true,
    fields: [
      t("otherInformation.priorPetitions.petitionInformation.name.firstName"),
      t("otherInformation.priorPetitions.petitionInformation.name.middleName"),
      t("otherInformation.priorPetitions.petitionInformation.name.lastName"),
      t("otherInformation.priorPetitions.petitionInformation.petitionLocation.city"),
      search("otherInformation.priorPetitions.petitionInformation.petitionLocation.state"),
      t("otherInformation.priorPetitions.petitionInformation.petitionDate"),
      t("otherInformation.priorPetitions.petitionInformation.petitionResult"),
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
  return fieldNamesOf(I130_PAGES);
}
