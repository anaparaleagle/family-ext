// ===========================================================================
// I-129 STRUCTURAL DESCRIPTOR — page order, URL slugs, per-field kind,
// upload-only pages.
//
// Form: I-129, Petition for a Nonimmigrant Worker (H-1B).
// Host:  https://my.uscis.gov/forms/petition-for-a-nonimmigrant-worker/
//          <draftId>/<slug>
//
// WHERE THIS CAME FROM — read this before trusting a field name.
// -------------------------------------------------------------
// This is a PORT, not a fresh capture. paraleagle-ext (the H-1B extension) has
// driven this form on my.uscis.gov since 2026-03, and its
// src/mappings/i129-field-map.ts + i129-subpages.ts are a live field dump
// written as TypeScript: Formik names read off the page with that extension's
// Scan All tool on 2026-03-13, corrected against live drafts through 2026-06-02
// (draft 12173958). That dump is vendored here as
// test/fixtures/i129-online-field-dump/i129-field-map-capture.json, and
// test/i129-coverage.test.ts holds this descriptor and the backend map to it in
// both directions.
//
// 29 pages, 157 distinct field names. Smaller than the N-400 (58 pages) this
// runner already drives.
//
// WHAT THE PORT ESTABLISHED (facts, not assumptions):
//  - Same React/Formik/MUI platform as the I-130 / I-539 / N-400, so the engine
//    value-setter and the Formik bridge drive it unchanged.
//  - NO applicant/beneficiary inversion here. On the online I-129 `applicant.*`
//    IS the PETITIONER (the employer) and `beneficiaryInfo.*` is the worker —
//    which happens to match our own petitioner.*/applicant.* convention. The
//    I-130's swap is an I-130-only trap; do NOT copy it into the backend map.
//  - Every input on a page shares that page's Formik prefix, so the slug table
//    below doubles as the routing table (that is what i129-subpages.ts was for).
//
// KNOWN GAPS (honest — do not paper over):
//
//  1. THE OEWS WAGE-LEVEL RADIO IS NOT DRIVEN. Its Formik name was never
//     captured: the H-1B extension reaches it with the wildcard selector
//     `[name*="wageLevel" i]` and a label-proximity fallback. Our engine
//     resolves a radio by (name, value) across a group and deliberately does not
//     apply `locate` to radios (value-setter.ts setValue), so there is no
//     name-free way to drive it. It sits on the DC general-information page and
//     is listed in I129_UNCAPTURED. One live walk turns it into one line.
//
//  2. FIVE RADIO GROUPS CARRY LABEL TEXT, NOT PROVEN OPTION VALUES. The H-1B
//     filler matches a radio option by SUBSTRING (i129-filler.ts matchesTarget),
//     so a multi-word string in its map is text that worked as a substring — not
//     a value proven to equal the input's `value`. Our setRadio matches EXACTLY.
//     The five are listed in I129_UNVERIFIED_OPTIONS and the coverage test locks
//     that list, so re-checking them is a defined job rather than a rumour. A
//     miss is loud and self-diagnosing: setRadio logs every option's value and
//     label on failure, which is exactly the capture needed to fix it.
//     The two/three-option true/false and coded groups (gender 3/1, the
//     classification codes) are verbatim and safe.
//
//  3. THE EVIDENCE SLUGS ARE MOSTLY UNCAPTURED, AND THE ELEVEN HEADINGS DO NOT
//     TRANSFER. paraleagle-ext drives its eleven I-129 upload pages entirely by
//     HEADING text (i129-doc-map.ts + detectDocUploadPage) and never reads a URL
//     there at all. Our doc-flow matches a backend `page_path` against the URL
//     (descriptorsForPath). So the heading table is not portable and slice 3
//     needs its own capture, on myUSCIS, the same way the LCA does on FLAG.
//     Four trailing URL segments happen to be written down in that repo's
//     comments and are declared below; the other seven pages are in
//     I129_UNCAPTURED. An undeclared upload page is not silent — the chain logs
//     "page not in descriptor" and walks past it, which is how the I-539's I-20
//     page was found.
//
// Field kinds follow the I-539/N-400 precedent:
//  - myUSCIS input MASKS (dates, ZIP, SSN, I-94, currency) are plain text inputs
//    -> "text". The H-1B map's `masked` and `currency` types collapse to it.
//  - MUI Autocompletes render as <input type="text"> but must be driven as
//    "search" with FULL DISPLAY TEXT — country, state, status code, SOC code,
//    education level, wage rate, consulate city.
//  - phones -> "phone".
// ===========================================================================

import { FormPage, check, cond, fieldNamesOf, phone, radio, search, t } from "../runner/types";

/**
 * Radio groups whose captured option strings are LABEL TEXT the H-1B filler
 * matched by substring, NOT values proven to equal the input's `value`.
 *
 * Locked by the coverage test against the vendored capture's
 * `options_verbatim: false` flag, so this list cannot drift away from the data
 * and cannot be quietly shortened. Settle each on a live walk (slice 4) and move
 * it out.
 */
export const I129_UNVERIFIED_OPTIONS: string[] = [
  "gettingStarted.reasonForRequest.basisForClassification",
  "gettingStarted.reasonForRequest2.requestedAction",
  "beneficiaryInfo.beneficiaryContactInformation.officeType",
  "employment.releaseOfTechOrTechnicalData.certRegardingReleaseOfControlTech",
  "h1b1DataCollection.numericalLimitationInformation.typeOfH1BPetition",
];

/**
 * What a live walk of this form still has to produce. Written down rather than
 * discovered later: each of these is a box that will be left blank or a page
 * that will be walked past, and none of them announces itself as a defect.
 */
export const I129_UNCAPTURED: string[] = [
  // The OEWS wage-level radio on the DC general-information page — see gap 1.
  "DC general information: the OEWS wage-level radio's Formik name",
  // Evidence pages paraleagle-ext only ever knew by heading — see gap 3. These
  // are its exact heading strings, so a capture run can be reconciled against
  // them one for one.
  "Evidence: slug for 'Evidence of certified labor condition application'",
  "Evidence: slug for 'Evidence of qualified specialty occupation'",
  "Evidence: slug for 'Degree or evidence of specialized training'",
  "Evidence: slug for 'Evidence of license and certificates'",
  "Evidence: slug for 'Written contract or terms of agreement'",
  "Evidence: slug for 'Evidence of available position'",
  "Evidence: slug for 'Additional evidence you want to provide'",
  // The four declared upload slugs are TRAILING SEGMENTS only, with no path
  // prefix recorded. Both matchers are suffix matches so they work, but a fuller
  // capture would make them tighter.
  "Evidence: the path prefix the four known slugs sit under (assumed /evidence/)",
  // The walk's terminus.
  "Review: the review-and-submit slug, and that the walk stops on it",
];

/**
 * The I-129 page walk, in order. Each `slug` is a path suffix under the draft
 * base path. The chain walks these via the form's own Next button — never by
 * URL-hopping, which myUSCIS answers by bouncing you back to the form start.
 *
 * Page order is the sidebar order the H-1B extension navigates in (Getting
 * Started, About Petitioner, About Beneficiary, Employment, H Classification
 * Supplement, H-1B Data Collection). Field order within a page is that
 * extension's declaration order, which tracks DOM order but has not been
 * re-verified box by box; the fill-chain plans by reveal dependency, not by
 * position, so order here is for readability.
 */
export const I129_PAGES: FormPage[] = [
  // ── Getting Started ──────────────────────────────────────────────────────
  {
    slug: "/getting-started/reason-for-request",
    title: "Reason for request",
    kind: "form",
    fields: [
      radio("gettingStarted.reasonForRequest.requestedNonimmigrantClass", [
        "H1B",
        "1B1",
        "1B2",
        "1B3",
      ]),
      // UNVERIFIED OPTION TEXT — see I129_UNVERIFIED_OPTIONS.
      radio("gettingStarted.reasonForRequest.basisForClassification", [
        "New Employment",
        "Continuation of previously approved employment without change with the same employer",
        "Change in previously approved employment",
        "New concurrent employment",
        "Change of employer",
        "Amended petition",
      ]),
      radio("formikFactoryUIMeta.gettingStarted.reasonForRequest.isCap", ["true", "false"]),
      // The number and its "I do not have one" tick, in that order — USCIS wants
      // one or the other, never neither, and a blank pair stalls Next. Same shape
      // as the I-539's A-Number / SSN / USCIS-number gates.
      t("gettingStarted.reasonForRequest.receiptNumber.number"),
      check("formikFactoryUIMeta.gettingStarted.reasonForRequest.receiptNumber.none"),
    ],
  },
  {
    slug: "/getting-started/reason-for-request/reason-for-request-page-2",
    title: "Reason for request page 2",
    kind: "form",
    fields: [
      // UNVERIFIED OPTION TEXT — see I129_UNVERIFIED_OPTIONS. A change of status
      // (every case type this form is registered for) is option B.
      radio("gettingStarted.reasonForRequest2.requestedAction", [
        "Notify the office in Part 4, so each beneficiary can obtain a visa or be admitted",
        "Change the status and extend the stay of each beneficiary because now in the USA in another status",
        "Extend the stay of each beneficiary because the beneficiary now hold(s) this status",
        "Amend the stay of each beneficiary because the beneficiaries",
        "Extend the status of a nonimmigrant classification based on a free trade agreement",
        "Change status to a nonimmigrant classification based on a free trade agreement",
      ]),
    ],
  },
  {
    slug: "/getting-started/processing-information",
    title: "Processing information",
    kind: "form",
    fields: [
      radio("gettingStarted.processingInformation.eachPetitionHasPassport.question", [
        "true",
        "false",
      ]),
      radio("gettingStarted.processingInformation.filingReplaceInitialI94.yesNoRadio", [
        "true",
        "false",
      ]),
      radio("gettingStarted.processingInformation.filingApplicationForDependents.yesNoRadio", [
        "true",
        "false",
      ]),
      radio("formikFactoryUIMeta.gettingStarted.processingInformation.premiumProcessing", [
        "true",
        "false",
      ]),
    ],
  },
  {
    // The FIRM's own block, filled from firm.* (FirmProfile / FirmOffice
    // columns), exactly like the I-539's preparer page. Note the shape differs
    // from the I-539's: here every box hangs off `preparer.helperInformation.`.
    slug: "/getting-started/preparer-information",
    title: "Preparer information",
    kind: "form",
    fields: [
      t("gettingStarted.preparer.helperInformation.name.lastName"),
      t("gettingStarted.preparer.helperInformation.name.firstName"),
      t("gettingStarted.preparer.helperInformation.business"),
      t("gettingStarted.preparer.helperInformation.address.addressLineOne"),
      t("gettingStarted.preparer.helperInformation.address.addressLineTwo"),
      t("gettingStarted.preparer.helperInformation.address.city"),
      search("gettingStarted.preparer.helperInformation.address.state"),
      t("gettingStarted.preparer.helperInformation.address.zipCode"),
      search("gettingStarted.preparer.helperInformation.address.country"),
      phone("gettingStarted.preparer.helperInformation.contact.daytimePhone"),
      t("gettingStarted.preparer.helperInformation.contact.faxNumber"),
      t("gettingStarted.preparer.helperInformation.contact.emailAddress"),
    ],
  },

  // ── About Petitioner (`applicant.*` — the EMPLOYER, not the worker) ───────
  {
    slug: "/about-petitioner/petitioner-name",
    title: "Petitioner's name",
    kind: "form",
    fields: [
      t("applicant.yourName.companyOrOrganizationName"),
      t("applicant.yourName.titleOfAuthorizedSignatory"),
    ],
  },
  {
    slug: "/about-petitioner/petitioner-contact-information",
    title: "Petitioner's contact information",
    kind: "form",
    fields: [
      phone("applicant.contactInfo.otherContact.daytimePhone"),
      phone("applicant.contactInfo.otherContact.mobilePhone"),
      check("formikFactoryUIMeta.applicant.contactInfo.otherContact.sameAsDaytimePhone"),
      t("applicant.contactInfo.otherContact.emailAddress"),
      t("applicant.contactInfo.mailingAddress.inCareOfName"),
      t("applicant.contactInfo.mailingAddress.addressLineOne"),
      t("applicant.contactInfo.mailingAddress.addressLineTwo"),
      t("applicant.contactInfo.mailingAddress.city"),
      search("applicant.contactInfo.mailingAddress.state"),
      t("applicant.contactInfo.mailingAddress.zipCode"),
      search("applicant.contactInfo.mailingAddress.country"),
    ],
  },
  {
    slug: "/about-petitioner/other-information",
    title: "Petitioner's other information",
    kind: "form",
    fields: [
      t("applicant.otherInfo.fein"),
      // An INDIVIDUAL petitioner's tax identifiers. Every case type this form is
      // registered for has a company petitioner, so these two are expected to be
      // absent — and the H-1B map carries them with no data source behind them
      // for the same reason.
      cond(t("applicant.otherInfo.irsTaxNumber.number")),
      cond(t("applicant.otherInfo.socialSecurityNumber.number")),
      radio("applicant.otherInfo.asylumFeeExemptEmployerNonProfitUSHigherEdu", ["true", "false"]),
    ],
  },

  // ── About Beneficiary (`beneficiaryInfo.*` — the worker) ──────────────────
  {
    slug: "/about-beneficiary/beneficiary-name",
    title: "Beneficiary's name",
    kind: "form",
    fields: [
      t("beneficiaryInfo.beneficiaryName.name.lastName"),
      t("beneficiaryInfo.beneficiaryName.name.firstName"),
      t("beneficiaryInfo.beneficiaryName.name.middleName"),
      radio("formikFactoryUIMeta.beneficiaryInfo.beneficiaryName.additionalNames.hasAdditionalNames", [
        "true",
        "false",
      ]),
    ],
  },
  {
    // THREE mutually-exclusive-ish blocks behind one question. `isUnitedStates`
    // is answered first; a CoS beneficiary is in the US, so the US mailing block
    // fills and the consulate block does not apply.
    //
    // The two lower blocks are marked conditional WITHOUT a `revealedBy`: which
    // of them myUSCIS actually renders for a given answer was never captured
    // (the H-1B extension deletes them from the PAYLOAD when the beneficiary is
    // in the US, which says nothing about the DOM). A bare `cond` probes and
    // skips quietly, which is right under either answer; a guessed `revealedBy`
    // would skip a block that was really there. The live walk settles it.
    slug: "/about-beneficiary/beneficiary-contact-information",
    title: "Beneficiary's contact information",
    kind: "form",
    fields: [
      radio("formikFactoryUIMeta.beneficiaryInfo.beneficiaryContactInformation.isUnitedStates", [
        "true",
        "false",
      ]),
      t("beneficiaryInfo.beneficiaryContactInformation.mailingAddress.addressLineOne"),
      t("beneficiaryInfo.beneficiaryContactInformation.mailingAddress.addressLineTwo"),
      t("beneficiaryInfo.beneficiaryContactInformation.mailingAddress.city"),
      search("beneficiaryInfo.beneficiaryContactInformation.mailingAddress.state"),
      t("beneficiaryInfo.beneficiaryContactInformation.mailingAddress.zipCode"),
      cond(t("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.addressLineOne")),
      cond(t("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.addressLineTwo")),
      cond(t("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.city")),
      cond(search("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.province")),
      cond(t("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.postalCode")),
      cond(search("beneficiaryInfo.beneficiaryContactInformation.foreignMailingAddress.country")),
      // The Part 4 consulate / port-of-entry block, which myUSCIS puts on this
      // page. UNVERIFIED OPTION TEXT on officeType.
      cond(radio("beneficiaryInfo.beneficiaryContactInformation.officeType", [
        "Consulate",
        "Pre-flight inspection",
        "Port of Entry",
      ])),
      cond(search("formikFactoryUIMeta.beneficiaryInfo.beneficiaryContactInformation.country")),
      cond(search("beneficiaryInfo.beneficiaryContactInformation.officeCity")),
    ],
  },
  {
    slug: "/about-beneficiary/when-and-where-they-were-born",
    title: "When and where they were born",
    kind: "form",
    fields: [
      t("beneficiaryInfo.whenAndWhereTheyWereBorn.dateOfBirth"),
      search("beneficiaryInfo.whenAndWhereTheyWereBorn.country"),
      search("beneficiaryInfo.whenAndWhereTheyWereBorn.province"),
    ],
  },
  {
    slug: "/about-beneficiary/immigration-information",
    title: "Immigration information",
    kind: "form",
    fields: [
      t("beneficiaryInfo.immigrationInformation.dateOfLastArrival"),
      // Number-then-tick pairs again: USCIS wants the number OR the "I do not
      // have or know it" tick.
      t("beneficiaryInfo.immigrationInformation.i94Number"),
      check("formikFactoryUIMeta.beneficiaryInfo.immigrationInformation.noI94Number"),
      t("beneficiaryInfo.immigrationInformation.passportOrTravelDocumentNumber"),
      check("formikFactoryUIMeta.beneficiaryInfo.immigrationInformation.noPassportOrTravelDocumentNumber"),
      t("beneficiaryInfo.immigrationInformation.passportOrTravelDocumentIssueDate"),
      t("beneficiaryInfo.immigrationInformation.passportOrTravelDocumentExpirationDate"),
      search("beneficiaryInfo.immigrationInformation.passportOrTravelDocumentCountryOfIssuance"),
    ],
  },
  {
    slug: "/about-beneficiary/immigration-information/immigration-information-page-2",
    title: "Immigration information page 2",
    kind: "form",
    fields: [
      search("beneficiaryInfo.immigrationInformation2.nonImmgrantStatusCode"),
      t("beneficiaryInfo.immigrationInformation2.statusExpirationDate"),
      // The D/S tick. An F-1 or J-2 beneficiary is admitted for duration of
      // status and has no expiry date to type, so without this the page cannot
      // be completed — and F-1 and J-2 are two of the six case types here.
      check("formikFactoryUIMeta.beneficiaryInfo.immigrationInformation2.noStatusExpirationDate"),
      // Status-specific: SEVIS for F/J, EAD for someone on OPT or an H-4 EAD.
      cond(t("beneficiaryInfo.immigrationInformation2.sevisNumber")),
      cond(t("beneficiaryInfo.immigrationInformation2.eadNumber.number")),
    ],
  },
  {
    slug: "/about-beneficiary/immigration-history",
    title: "Immigration history",
    kind: "form",
    fields: [
      radio("beneficiaryInfo.immigrationHistory.everPreviouslyFiledForBeneficiary.question", [
        "true",
        "false",
      ]),
      cond(t("formikFactoryUIMeta.beneficiaryInfo.immigrationHistory.everPreviouslyFiledForBeneficiary.explanation"), {
        by: "beneficiaryInfo.immigrationHistory.everPreviouslyFiledForBeneficiary.question",
        is: "true",
      }),
      radio("beneficiaryInfo.immigrationHistory.beneficiaryInRemoval", ["true", "false"]),
      radio("beneficiaryInfo.immigrationHistory.filedForAnyBeneficiary.yesNoRadio", [
        "true",
        "false",
      ]),
    ],
  },
  {
    slug: "/about-beneficiary/immigration-history/immigration-history-page-2",
    title: "Immigration history page 2",
    kind: "form",
    fields: [
      radio("beneficiaryInfo.immigrationHistory2.heldJVisa", ["true", "false"]),
      radio("beneficiaryInfo.immigrationHistory2.petitionHistory.previouslyReceivedBenefit.question", [
        "true",
        "false",
      ]),
      radio("beneficiaryInfo.immigrationHistory2.petitionHistory.previouslyDeniedBenefit.question", [
        "true",
        "false",
      ]),
    ],
  },
  {
    slug: "/about-beneficiary/beneficiarys-other-information",
    title: "Beneficiary's other information",
    kind: "form",
    fields: [
      search("beneficiaryInfo.otherInformation.citizenshipCountry"),
      // 3 = Male, 1 = Female. The same backwards-reading pair the I-130 and the
      // N-400 captures both locked; it is a myUSCIS-wide convention, not a typo.
      radio("beneficiaryInfo.otherInformation.gender", ["3", "1"]),
      t("beneficiaryInfo.otherInformation.alienNumber.number"),
      t("beneficiaryInfo.otherInformation.socialSecurityNumber.number"),
    ],
  },

  // ── Employment ───────────────────────────────────────────────────────────
  {
    slug: "/employment/basic-information",
    title: "Basic information",
    kind: "form",
    fields: [
      t("employment.basicInformation.jobTitle"),
      t("employment.basicInformation.lcaOrEtaCaseNumber"),
      radio("employment.basicInformation.fulltime", ["true", "false"]),
      t("employment.basicInformation.wage.amount"),
      search("employment.basicInformation.wage.rate"),
      radio("formikFactoryUIMeta.employment.basicInformation.otherCompensation.anyOtherCompensation", [
        "true",
        "false",
      ]),
      cond(t("employment.basicInformation.otherCompensation.explanation"), {
        by: "formikFactoryUIMeta.employment.basicInformation.otherCompensation.anyOtherCompensation",
        is: "true",
      }),
      t("employment.basicInformation.datesOfIntendedEmployment.fromDate"),
      t("employment.basicInformation.datesOfIntendedEmployment.toDate"),
    ],
  },
  {
    slug: "/employment/employer-information",
    title: "Petitioner information (employer)",
    kind: "form",
    fields: [
      t("employment.employerInformation.typeOfBusiness"),
      t("employment.employerInformation.yearBusinessEstablished"),
      t("employment.employerInformation.currentNumberOfEmployeesInUS"),
      radio("employment.employerInformation.currentlyEmployTotalOf25OrFewerFullTime", [
        "true",
        "false",
      ]),
      t("employment.employerInformation.grossAnnualIncome"),
      t("employment.employerInformation.netAnnualIncome"),
    ],
  },
  {
    // The work address is an index-0 row of `additionalWorkAddresses`, but it is
    // NOT a repeater here: the H-1B extension only ever drove row 0 and the
    // worksite we hold is a single JSON fact. Declared as flat `.0.` names so
    // the chain fills the first row without an "Add" click; a second worksite is
    // a later job with a real capture behind it.
    slug: "/employment/work-location",
    title: "Work location",
    kind: "form",
    fields: [
      radio("formikFactoryUIMeta.employment.workLocation.sameAsMailing", ["true", "false"]),
      cond(t("employment.workLocation.additionalWorkAddresses.0.addressLineOne"), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
      cond(t("employment.workLocation.additionalWorkAddresses.0.addressLineTwo"), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
      cond(t("employment.workLocation.additionalWorkAddresses.0.city"), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
      cond(search("employment.workLocation.additionalWorkAddresses.0.state"), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
      cond(t("employment.workLocation.additionalWorkAddresses.0.zipCode"), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
      cond(radio("employment.workLocation.additionalWorkAddresses.0.thirdPartyLocation", ["true", "false"]), {
        by: "formikFactoryUIMeta.employment.workLocation.sameAsMailing",
        is: "false",
      }),
    ],
  },
  {
    slug: "/employment/work-location/work-location-2",
    title: "Work location page 2",
    kind: "form",
    fields: [
      radio("employment.workLocation2.workOffSite", ["true", "false"]),
      radio("employment.workLocation2.itineraryIncluded", ["true", "false"]),
      radio("employment.workLocation2.workInCNMI", ["true", "false"]),
    ],
  },
  {
    // EAR / ITAR. UNVERIFIED OPTION TEXT — and this one is an ATTESTATION about
    // export-control licensing, so a wrong click is a wrong statement on a filed
    // petition, not a cosmetic miss. The backend sends the standing "a license is
    // not required" answer the firm applies to every case; a human still reviews
    // it, and a radio miss here is loud.
    slug: "/employment/release-of-controlled-technology-certification",
    title: "Release of controlled technology",
    kind: "form",
    fields: [
      radio("employment.releaseOfTechOrTechnicalData.certRegardingReleaseOfControlTech", [
        "license is not required",
        "a license is required",
      ]),
    ],
  },

  // ── H Classification Supplement ──────────────────────────────────────────
  {
    // The cap-registration block. All six case types this form is registered for
    // are CAP-EXEMPT changes of status, so there is no registration and no
    // selected-passport to record: the number's "I do not have one" tick is what
    // gets driven, and the three passport boxes stay empty.
    slug: "/h-classification-supplement/general-information",
    title: "HS general information",
    kind: "form",
    fields: [
      cond(t("hClassificationSupplement.generalInformation.beneficiaryConfirmationNumber.number")),
      check("formikFactoryUIMeta.hClassificationSupplement.generalInformation.beneficiaryConfirmationNumber.none"),
      cond(t("hClassificationSupplement.generalInformation.capBeneficiaryPassportNumber")),
      cond(search("hClassificationSupplement.generalInformation.capBeneficiaryPassportOrTravelDocCountryOfIssuance")),
      cond(t("hClassificationSupplement.generalInformation.capBeneficiaryPassportOrTravelDocExpirationDate")),
      radio("hClassificationSupplement.generalInformation.beneficiaryGuamCNMI", ["true", "false"]),
      radio("hClassificationSupplement.generalInformation.changeEmployerGuamCNMI", ["true", "false"]),
      // NOT DRIVEN: the OEWS wage-level radio also lives on this page. See gap 1
      // and I129_UNCAPTURED.
    ],
  },
  {
    slug: "/h-classification-supplement/beneficiary-information",
    title: "HS beneficiary information",
    kind: "form",
    fields: [
      radio("hClassificationSupplement.beneInformation.beneficiaryHaveOwnership.question", [
        "true",
        "false",
      ]),
      t("hClassificationSupplement.beneInformation.beneficiaryProposedDuties"),
      t("hClassificationSupplement.beneInformation.beneficiaryCurrentDuties"),
    ],
  },

  // ── H-1B Data Collection & Fee Exemption Supplement ──────────────────────
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/general-information",
    title: "DC general information",
    kind: "form",
    fields: [
      radio("h1b1DataCollection.generalInformation.h1bDependentEmployer", ["true", "false"]),
      radio("h1b1DataCollection.generalInformation.willfulViolater", ["true", "false"]),
      radio("h1b1DataCollection.generalInformation.h1bNonimmigrantExempt", ["true", "false"]),
      // The two grounds for the exemption, only asked once it is claimed.
      cond(check("h1b1DataCollection.generalInformation.beneficiaryExempt.payAtLeast60000"), {
        by: "h1b1DataCollection.generalInformation.h1bNonimmigrantExempt",
        is: "true",
      }),
      cond(check("h1b1DataCollection.generalInformation.beneficiaryExempt.mastersDegreeOrHigher"), {
        by: "h1b1DataCollection.generalInformation.h1bNonimmigrantExempt",
        is: "true",
      }),
      radio("h1b1DataCollection.generalInformation.employMoreThan50Individuals", ["true", "false"]),
      radio("h1b1DataCollection.generalInformation.moreThan50PercentH1bL1AL1B", ["true", "false"]),
    ],
  },
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/beneficiary-information",
    title: "DC beneficiary's information",
    kind: "form",
    fields: [
      search("h1b1DataCollection.beneficiaryInformation.highestLevelOfEducation"),
      t("h1b1DataCollection.beneficiaryInformation.majorPrimaryFieldOfStudy"),
      t("h1b1DataCollection.beneficiaryInformation.rateOfPayPerYear"),
      search("h1b1DataCollection.beneficiaryInformation.socCode"),
      t("h1b1DataCollection.beneficiaryInformation.naicsCode"),
    ],
  },
  {
    // Section A questions 1.c / 1.d — the "describe the job's requirements"
    // free-text boxes, asked only down the H-1B-dependent / willful-violator
    // branch. Which upstream answer opens them was not captured, so these are
    // bare conditionals: probe, fill if there, skip quietly if not.
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/beneficiary-information/beneficiary-information-2",
    title: "DC beneficiary's information page 2",
    kind: "form",
    fields: [
      cond(t("h1b1DataCollection.beneficiaryInformation2.levelOfEducation")),
      cond(t("h1b1DataCollection.beneficiaryInformation2.fieldsOfStudy")),
      cond(t("h1b1DataCollection.beneficiaryInformation2.yearsOfExperience")),
      cond(t("h1b1DataCollection.beneficiaryInformation2.specialSkills")),
      cond(t("h1b1DataCollection.beneficiaryInformation2.supervisePositions")),
    ],
  },
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/fee-exemption-and-or-determination",
    title: "DC fee exemption",
    kind: "form",
    fields: [
      radio("h1b1DataCollection.feeExemptionDetermination.institutionOfHigherLearning", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination.nonProfitOrgRelatedToHigherEd", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination.nonProfitResearchOrgOrGovResearchOrg", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination.secondRequestForExtForPetitioner", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination.amendedPetitionDoesNotContainRequestForStay", [
        "true",
        "false",
      ]),
    ],
  },
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/fee-exemption-and-or-determination/fee-exemption-and-or-determination-page-2",
    title: "DC fee exemption page 2",
    kind: "form",
    fields: [
      radio("h1b1DataCollection.feeExemptionDetermination2.isFilingToCorrectUSCISError", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination2.isPrimaryOrSecondaryEducation", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.feeExemptionDetermination2.nonProfitWithClinicalTraining", [
        "true",
        "false",
      ]),
    ],
  },
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/numerical-limitation-information",
    title: "DC numerical limitation",
    kind: "form",
    fields: [
      // UNVERIFIED OPTION TEXT. Every case type here is "CAP Exempt".
      radio("h1b1DataCollection.numericalLimitationInformation.typeOfH1BPetition", [
        "CAP H-1B Bachelor's Degree",
        "CAP H-1B U.S. Master's Degree or Higher",
        "CAP H-1B1 Chile/Singapore",
        "CAP Exempt",
      ]),
      // The U.S. master's-degree block, asked only on the master's-cap branch.
      // No `revealedBy`: the option string that would open it is itself
      // unverified, and a `revealedBy` pointing at the wrong string SKIPS the
      // block instead of failing loudly. Bare conditionals until the walk.
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.nameOfUSInstitutionOfHigherEducation")),
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.typeOfUSDegree")),
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.addressOfUSInstituionOfHigherEducation.addressLineOne")),
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.addressOfUSInstituionOfHigherEducation.city")),
      cond(search("h1b1DataCollection.numericalLimitationInformation.mastersDegree.addressOfUSInstituionOfHigherEducation.state")),
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.addressOfUSInstituionOfHigherEducation.zipCode")),
      cond(t("h1b1DataCollection.numericalLimitationInformation.mastersDegree.dateDegreeAwarded")),
    ],
  },
  {
    slug: "/h-1b-and-h-1b1-data-collection-and-filling-fee-exemption-supplement/off-site-assignment",
    title: "DC off-site assignment",
    kind: "form",
    fields: [
      radio("h1b1DataCollection.offsiteAssignment.beneficiaryAssignedToWorkOffsite", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.offsiteAssignment.placementCompliesWithStatutoryRequirements", [
        "true",
        "false",
      ]),
      radio("h1b1DataCollection.offsiteAssignment.beneficiaryPaidHigherWageAtOffsite", [
        "true",
        "false",
      ]),
    ],
  },

  // ── Evidence (uploads — a dropzone file input, nothing to type) ───────────
  //
  // FOUR of eleven, and they are TRAILING SEGMENTS, not full paths. These are the
  // only I-129 evidence URLs written down anywhere: paraleagle-ext navigates its
  // upload pages purely by heading text and left these four in comments. NO PATH
  // PREFIX was recorded, so none is invented here — both `pageForUrl` and
  // `descriptorsForPath` are suffix matches, so a bare trailing segment matches
  // whatever prefix myUSCIS really serves.
  //
  // The other seven pages, and the prefix, are in I129_UNCAPTURED. The certified
  // LCA page is among them, and it is the one that matters most: its rule is
  // CERTIFIED-ONLY — doc_type `certified_lca` and never a generated LCA PDF,
  // because filing an uncertified LCA is a compliance defect. Until its slug is
  // captured the page will be walked past with a "page not in descriptor" line,
  // which is visible, rather than filled with the wrong file, which would not be.
  {
    slug: "passport-or-travel-document",
    title: "Passport or travel document",
    kind: "upload",
    fields: [],
  },
  {
    // Note the capital B, as paraleagle-ext recorded it. Page detection is a
    // case-sensitive path-suffix match — the I-539's `/evidence/form-I-20` cost a
    // live run to learn that.
    slug: "h-1B-registration-selection-notice",
    title: "H-1B registration selection notice",
    kind: "upload",
    fields: [],
  },
  {
    slug: "basis-of-the-wage-level",
    title: "Basis of the wage level",
    kind: "upload",
    fields: [],
  },
  {
    slug: "form-i-94-passport-travel-documents-or-form-i-797",
    title: "Maintenance of status",
    kind: "upload",
    fields: [],
  },
];

/**
 * Every distinct field name this descriptor drives — what the coverage test
 * checks the backend map against.
 */
export function descriptorFieldNames(): string[] {
  return fieldNamesOf(I129_PAGES);
}
