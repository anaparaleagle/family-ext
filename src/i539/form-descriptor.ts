// ===========================================================================
// I-539 STRUCTURAL DESCRIPTOR — page order, URL slugs, per-field kind, repeater
// flags, upload-only pages. Authored from paraleagle-dev/i539-online-field-dump/
// (23 primary screens f1-cos/00..22b + the reason/status delta captures in
// f1-eos, b1b2, j1, h4, l2; captured live 2026-07-15, throwaway draft 13212561).
//
// Form: I-539, Application To Extend/Change Nonimmigrant Status.
// Host:  https://my.uscis.gov/forms/application-to-extend-change-nonimmigrant-status/
//          <draftId>/<slug>?app_to_rep_id=<uuid>
//
// WHAT THE CAPTURE ESTABLISHED (facts, not assumptions):
//  - Same React/Formik/MUI platform as the I-130, so the engine value-setter and
//    the Formik bridge drive it unchanged.
//  - The SIDEBAR IS STABLE across every status (F-1, B-1/B-2, J-1, H-4, L-2) and
//    every reason (extension / change / reinstatement). Branching is FIELD-LEVEL
//    inside pages, never whole-section. That is why this is ONE linear ~23-screen
//    descriptor with conditional fields, NOT a per-category union.
//  - ONE party: `applicant.*` is the applicant, full stop. There is NO
//    applicant/beneficiary inversion here (that is an I-130-only trap).
//  - The page HEADING is identical on every screen ("I-539, Application To
//    Extend/Change Nonimmigrant Status"), so heading-fallback detection cannot
//    disambiguate I-539 pages — the URL slug is the only signal. Titles below are
//    the SIDEBAR labels, used for logging/audit output.
//
// KNOWN GAPS (honest — do not paper over):
//  1. THE REVIEW PAGE WAS NEVER CAPTURED. The sidebar shows a "Review and Submit"
//     section but no screen dump exists, so its slug is unknown and it is NOT in
//     this descriptor. The walk therefore treats it as an unrecognized page. The
//     hard backstop is fill-chain's NEVER_CLICK_TEXT guard, which refuses to
//     click any Submit/Pay/e-sign control. Capture that page and add a
//     `kind: "review"` entry before any live end-to-end run.
//  2. The `formikFactoryUIMeta.*` toggles are in I539_SKIP (below), not in any
//     page's `fields` — see that list for the consequence.
//
// Field kinds follow the I-130 precedent + the live lesson from 2026-06-26:
//  - MUI Autocompletes render as <input type="text"> in a dump but must be
//    driven as "search" and given FULL DISPLAY TEXT, not a code. That covers
//    country, state, the current-status picker and the change-of-status target.
//  - phones -> "phone"; dates are plain masked text -> "text"; free-text
//    explanations -> "textarea".
//  - radios carry real option values captured from the dump (mostly "true"/
//    "false", but note applicationType / basedOnSeparateFamilyPetition /
//    selectedFormType use word codes).
// ===========================================================================

import { FormPage, area, cond, phone, radio, search, t } from "../runner/types";

/**
 * Dump field names the descriptor deliberately does NOT drive. The
 * descriptor<->dump coverage test asserts that every fillable field in the
 * f1-cos capture is either in I539_PAGES or listed here — so this list is the
 * explicit, reviewed record of what we leave alone, and nothing can fall through
 * the cracks silently.
 *
 * Two groups, both intentional:
 *
 * 1. `formikFactoryUIMeta.*` — UI-only toggles the APPLICANT/user answers, not
 *    FACT data (the I-130 leaves the same class of toggle unmapped). These are
 *    the preparer/interpreter helper questions plus the "I do not have or know
 *    my X" checkboxes.
 *    CONSEQUENCE, stated plainly: several of these GATE a required field. If the
 *    applicant genuinely has no A-Number, the online form needs
 *    `...alienNumber.none` CHECKED before Next will enable; we will not check it,
 *    so a Fill-all run stops there until a human ticks the box. That is the
 *    correct trade for now — the backend map does not exist yet, so there is no
 *    resolved value that could decide it. To enable it later, move the toggle
 *    out of this list into its page's `fields` as `check(...)`; the engine's
 *    checkbox setter already handles truthy values. planPageFill only fills
 *    names that appear in a page's `fields`, so skip == permanently unfilled.
 *
 * 2. `gettingStarted.preparer.*` / `gettingStarted.interpreter.*` — the firm's
 *    own preparer/interpreter identity, not applicant FACTs. Their PAGES are in
 *    the descriptor (with empty `fields`) so the walk recognizes and steps past
 *    them instead of logging them as unknown.
 */
export const I539_SKIP: string[] = [
  // 1. UI-meta toggles — the user answers these.
  "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper",
  "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer",
  "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter",
  "formikFactoryUIMeta.gettingStarted.preparer.noBusiness",
  "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone",
  "formikFactoryUIMeta.gettingStarted.preparer.contact.noEmailAddress",
  "formikFactoryUIMeta.gettingStarted.interpreter.noBusiness",
  "formikFactoryUIMeta.gettingStarted.interpreter.contact.noMobilePhone",
  "formikFactoryUIMeta.gettingStarted.interpreter.contact.noEmailAddress",
  "formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.sameAsDaytimePhone",
  "formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.noEmail",
  "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.passport.none",
  "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.noTravelDocumentNumber",
  "formikFactoryUIMeta.applicant.otherInformation.alienNumber.none",
  "formikFactoryUIMeta.applicant.otherInformation.socialSecurityNumber.none",
  "formikFactoryUIMeta.applicant.otherInformation.uscisNumber.none",

  // 2. Preparer / interpreter identity — the firm's own details, not FACTs.
  "gettingStarted.preparer.name.firstName",
  "gettingStarted.preparer.name.lastName",
  "gettingStarted.preparer.business",
  "gettingStarted.preparer.contact.daytimePhone",
  "gettingStarted.preparer.contact.mobilePhone",
  "gettingStarted.preparer.contact.emailAddress",
  "gettingStarted.interpreter.name.firstName",
  "gettingStarted.interpreter.name.lastName",
  "gettingStarted.interpreter.business",
  "gettingStarted.interpreter.contact.daytimePhone",
  "gettingStarted.interpreter.contact.mobilePhone",
  "gettingStarted.interpreter.contact.emailAddress",
  "gettingStarted.interpreter.language",
];

/**
 * The I-539 page walk, in order. Each `slug` is appended to the draft base path.
 * The chain walks these via the form's own Next button (never URL-hopping —
 * myUSCIS redirects you to the form start if you deep-link past a prerequisite).
 */
export const I539_PAGES: FormPage[] = [
  // ── Start (pre-draft intro screens; no draftId in the path yet) ───────────
  // Captured (f1-cos/00, 01) and listed so the walk recognizes rather than logs
  // them as unknown. They carry no inputs; their advance control is "Start",
  // not "Next", so a Fill-all started here stops — start the form by hand.
  {
    slug: "/start/overview",
    title: "Overview",
    kind: "form",
    fields: [],
  },
  {
    slug: "/start/start-application",
    title: "Completing your form online",
    kind: "form",
    fields: [],
  },

  // ── Getting Started ──────────────────────────────────────────────────────
  {
    // f1-cos/02 + b1b2/01. `currentNonImmigrantStatus` is an MUI autocomplete
    // over 68 status codes that filters by USCIS DISPLAY TEXT, not the code
    // ("F1" will NOT match — "Student, Academic Or Language Program." does).
    // See misc/currentNonImmigrantStatus-options.json; the backend must emit the
    // display text.
    slug: "/getting-started/basis-of-eligibility",
    title: "Basis of eligibility",
    kind: "form",
    fields: [
      search("gettingStarted.basisOfEligibility.currentNonImmigrantStatus"),
      radio("gettingStarted.basisOfEligibility.isGrantedDurationOfStatus", ["true", "false"]),
      t("gettingStarted.basisOfEligibility.currentNonImmigrantStatusExpirationDate"),
      // Online I-539 is single-applicant only: "false" here forces a paper
      // filing, so a family case that reaches this extension is always "true".
      radio("gettingStarted.basisOfEligibility.isOnlyApplicant", ["true", "false"]),
    ],
  },
  {
    // f1-cos/03 + 03b. `applicationType` drives the whole form's reason. The
    // option set is status-dependent: "reinstatementToStudentStatus" appears
    // only for F/M (f1-cos, f1-eos); b1b2/j1/h4/l2 show just the other two. The
    // union is listed — the engine selects by the emitted value.
    // 03 -> 03b: choosing "changeOfStatus" REVEALS the target + effective date.
    slug: "/getting-started/reason-for-request",
    title: "Reason for request",
    kind: "form",
    fields: [
      radio("gettingStarted.reasonForRequest.applicationType", [
        "extensionOfStay",
        "reinstatementToStudentStatus",
        "changeOfStatus",
      ]),
      // Same display-text autocomplete trap as currentNonImmigrantStatus — see
      // misc/changeOfStatus-target-options.json.
      cond(search("gettingStarted.reasonForRequest.statusInfo.changeOfStatus")),
      cond(t("gettingStarted.reasonForRequest.statusInfo.dateOfChange")),
      t("gettingStarted.reasonForRequest.requestedDateOfExtension"),
    ],
  },
  {
    // f1-cos/04 + 04b. Every field here is a formikFactoryUIMeta helper toggle
    // (in I539_SKIP) — the page is listed so the walk steps past it cleanly.
    slug: "/getting-started/preparer-and-interpreter-information",
    title: "Preparer and interpreter information",
    kind: "form",
    fields: [],
  },
  {
    // f1-cos/05. Only reachable when hasHelper + hasPreparer are Yes. All fields
    // are the firm's own preparer identity — in I539_SKIP.
    slug: "/getting-started/preparer",
    title: "Preparer information",
    kind: "form",
    conditional: true,
    fields: [],
  },
  {
    // f1-cos/06. Only reachable when hasHelper + hasInterpreter are Yes.
    slug: "/getting-started/interpreter",
    title: "Interpreter information",
    kind: "form",
    conditional: true,
    fields: [],
  },

  // ── About You (the single applicant.* party — no inversion) ───────────────
  {
    // f1-cos/07. No "other names used" repeater on the I-539 (unlike the I-130).
    slug: "/about-you/your-name",
    title: "Your name",
    kind: "form",
    fields: [
      t("applicant.yourName.name.firstName"),
      t("applicant.yourName.name.middleName"),
      t("applicant.yourName.name.lastName"),
    ],
  },
  {
    // f1-cos/08 + 08b. The mailing address is US-only (no country input). The
    // US physical address block is revealed by isMailingEqualToPhysical=false
    // (08b); the FOREIGN physical address block is NOT conditional — it renders
    // in both captures ("What is your physical address abroad?").
    slug: "/about-you/your-contact-information",
    title: "Your contact information",
    kind: "form",
    fields: [
      phone("applicant.yourContactInformation.contactInformation.daytimePhone"),
      phone("applicant.yourContactInformation.contactInformation.mobilePhone"),
      t("applicant.yourContactInformation.contactInformation.emailAddress"),
      t("applicant.yourContactInformation.mailingAddress.inCareOfName"),
      t("applicant.yourContactInformation.mailingAddress.addressLineOne"),
      t("applicant.yourContactInformation.mailingAddress.addressLineTwo"),
      t("applicant.yourContactInformation.mailingAddress.city"),
      search("applicant.yourContactInformation.mailingAddress.state"),
      t("applicant.yourContactInformation.mailingAddress.zipCode"),
      radio("applicant.yourContactInformation.isMailingEqualToPhysical", ["true", "false"]),
      cond(t("applicant.yourContactInformation.physicalAddresses.addressLineOne")),
      cond(t("applicant.yourContactInformation.physicalAddresses.addressLineTwo")),
      cond(t("applicant.yourContactInformation.physicalAddresses.city")),
      cond(search("applicant.yourContactInformation.physicalAddresses.state")),
      cond(t("applicant.yourContactInformation.physicalAddresses.zipCode")),
      search("applicant.yourContactInformation.foreignPhysicalAddress.country"),
      t("applicant.yourContactInformation.foreignPhysicalAddress.addressLineOne"),
      t("applicant.yourContactInformation.foreignPhysicalAddress.addressLineTwo"),
      t("applicant.yourContactInformation.foreignPhysicalAddress.city"),
      t("applicant.yourContactInformation.foreignPhysicalAddress.province"),
      t("applicant.yourContactInformation.foreignPhysicalAddress.postalCode"),
    ],
  },
  {
    // f1-cos/09 + 09b. The "revealed" capture is IDENTICAL to the base one —
    // nothing on this page is conditional (there is no city-of-birth input).
    slug: "/about-you/when-and-where-you-were-born",
    title: "When and where you were born",
    kind: "form",
    fields: [
      t("applicant.whenAndWhereYouWereBorn.dob"),
      search("applicant.whenAndWhereYouWereBorn.birthAddress.country"),
    ],
  },
  {
    // f1-cos/10. Most-recent-entry block. The passport/travel-document number
    // inputs are gated by their "I do not have …" UI-meta checkboxes (skipped).
    slug: "/about-you/your-immigration-information",
    title: "Your immigration information",
    kind: "form",
    fields: [
      search(
        "applicant.yourImmigrationInformation.yourImmigrationInformation1.countryOfCitizenshipOrNationality",
      ),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.dateOfLastArrival"),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.i94Number"),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.passport.number"),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.travelDocumentNumber"),
      search("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.countryOfIssuance"),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.expirationDate"),
    ],
  },
  {
    // f1-cos/11 + 11b: isCurrentPassportDifferent=true reveals the current
    // passport block. Note the doubled `.number.number` leaf — that IS the live
    // name, not a typo.
    slug: "/about-you/your-immigration-information/your-immigration-information-page-2",
    title: "Your immigration information (2)",
    kind: "form",
    fields: [
      radio("applicant.yourImmigrationInformation.yourImmigrationInformation2.isCurrentPassportDifferent", [
        "true",
        "false",
      ]),
      cond(t("applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.number.number")),
      cond(search("applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.countryOfIssuance")),
      cond(t("applicant.yourImmigrationInformation.yourImmigrationInformation2.passport.expirationDate")),
    ],
  },
  {
    // f1-cos/12 + b1b2/03. schoolName/sevisNumber are F/M/J-only in practice but
    // the inputs render for every status.
    slug: "/about-you/other-information",
    title: "Other information",
    kind: "form",
    fields: [
      t("applicant.otherInformation.alienNumber.number"),
      t("applicant.otherInformation.socialSecurityNumber.number"),
      t("applicant.otherInformation.uscisNumber.number"),
      t("applicant.otherInformation.schoolName"),
      t("applicant.otherInformation.sevisNumber"),
    ],
  },

  // ── Moral Character ──────────────────────────────────────────────────────
  // Four pages of EVER-questions, all plain true/false radios with a `.question`
  // leaf. A "true" answer on any of these is a serious disclosure; the backend
  // map decides the values (our elig_q* facts) — the extension only types them.
  {
    slug: "/moral-character/party-and-group-affiliations",
    title: "Party and group affiliations",
    kind: "form",
    fields: [
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInTortureOrGenocide.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInKillingAnyPerson.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInInjuringAnyPerson.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInForcedSexualContact.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage1.hasParticipatedInDenyingReligiousBeliefs.question",
        ["true", "false"],
      ),
    ],
  },
  {
    slug: "/moral-character/party-and-group-affiliations/party-and-group-affiliations-page-2",
    title: "Party and group affiliations (2)",
    kind: "form",
    fields: [
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage2.hasServedInMilitary.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage2.hasServedInPrison.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage2.hasServedInOrganizationWithWeapons.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage2.hasTransportedWeapons.question",
        ["true", "false"],
      ),
      radio(
        "moralCharacter.partyAndGroupAffiliations.partyAndGroupAffiliationsPage2.hasWeaponsTraining.question",
        ["true", "false"],
      ),
    ],
  },
  {
    slug: "/moral-character/immigration-proceedings",
    title: "Immigration proceedings",
    kind: "form",
    fields: [
      radio("moralCharacter.immigrationProceedings.hasViolatedNonImmigrantStatus.question", ["true", "false"]),
      radio("moralCharacter.immigrationProceedings.isInRemovalProceedings.question", ["true", "false"]),
    ],
  },
  {
    slug: "/moral-character/crimes-and-offenses",
    title: "Crimes and offenses",
    kind: "form",
    fields: [
      radio("moralCharacter.crimesAndOffenses.hasBeenArrestedOrConvicted.question", ["true", "false"]),
    ],
  },

  // ── Your Application ─────────────────────────────────────────────────────
  {
    // f1-cos/17 + 17b. This is the DEPENDENT'S hook to the principal's petition:
    // answering basedOnSeparateFamilyPetition with anything but "no" reveals the
    // form type / receipt number / principal's name / filing date. Note it is a
    // THREE-option radio using word codes, not a yes/no.
    slug: "/your-application/information-about-request",
    title: "Information about request",
    kind: "form",
    fields: [
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage1.isBasedOnGrantedFamilyPetition",
        ["true", "false"],
      ),
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage1.basedOnSeparateFamilyPetition",
        ["filedWithThisI539", "no", "filedPreviouslyAndPending"],
      ),
      cond(
        radio("yourApplication.informationAboutRequest.informationAboutRequestPage1.selectedFormType", [
          "formI129",
          "formI539",
        ]),
      ),
      cond(
        t(
          "yourApplication.informationAboutRequest.informationAboutRequestPage1.separatePetitionReceiptNumber.receiptNumber",
        ),
      ),
      cond(t("yourApplication.informationAboutRequest.informationAboutRequestPage1.fullName.firstName")),
      cond(t("yourApplication.informationAboutRequest.informationAboutRequestPage1.fullName.lastName")),
      cond(t("yourApplication.informationAboutRequest.informationAboutRequestPage1.dateFiled")),
    ],
  },
  {
    // f1-cos/18 + 18b: each "true" reveals that question's free-text explanation.
    // Note the odd leaves — isEmployedInUs uses `.isEmployedInUsQuestion` and
    // `.employmentAdditionalExplanation`, not the `.question` /
    // `.additionalExplanation` pattern the other four use. Live names, verbatim.
    slug: "/your-application/information-about-request/information-about-request-page-2",
    title: "Information about request (2)",
    kind: "form",
    fields: [
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage2.isApplicantForImmigrantVisa.question",
        ["true", "false"],
      ),
      cond(
        area(
          "yourApplication.informationAboutRequest.informationAboutRequestPage2.isApplicantForImmigrantVisa.additionalExplanation",
        ),
      ),
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage2.hasImmigrantPetitionBeenFiled.question",
        ["true", "false"],
      ),
      cond(
        area(
          "yourApplication.informationAboutRequest.informationAboutRequestPage2.hasImmigrantPetitionBeenFiled.additionalExplanation",
        ),
      ),
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage2.hasI485BeenFiled.question",
        ["true", "false"],
      ),
      cond(
        area(
          "yourApplication.informationAboutRequest.informationAboutRequestPage2.hasI485BeenFiled.additionalExplanation",
        ),
      ),
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage2.isEmployedInUs.isEmployedInUsQuestion",
        ["true", "false"],
      ),
      cond(
        area(
          "yourApplication.informationAboutRequest.informationAboutRequestPage2.isEmployedInUs.employmentAdditionalExplanation",
        ),
      ),
      radio(
        "yourApplication.informationAboutRequest.informationAboutRequestPage2.isExchangeVisitorOrDependent.question",
        ["true", "false"],
      ),
      cond(
        area(
          "yourApplication.informationAboutRequest.informationAboutRequestPage2.isExchangeVisitorOrDependent.additionalExplanation",
        ),
      ),
    ],
  },

  // ── Evidence (uploads — a dropzone file input, nothing to type) ───────────
  // Each needs a backend upload_pages descriptor to resolve to bytes; until the
  // I-539 backend map exists the doc-flow finds none and logs a skip.
  {
    // REQUIRED. accept=jpg/jpeg/pdf/tif/tiff, max 12MB/file.
    slug: "/evidence/form-i-94",
    title: "Form I-94",
    kind: "upload",
    fields: [],
  },
  {
    // REQUIRED.
    slug: "/evidence/written-statement",
    title: "Written statement",
    kind: "upload",
    fields: [],
  },
  {
    // OPTIONAL — Next is enabled with nothing attached.
    slug: "/evidence/additional-evidence",
    title: "Additional evidence",
    kind: "upload",
    fields: [],
  },

  // ── Additional Information ───────────────────────────────────────────────
  {
    // f1-cos/22 + 22b. Renders NO inputs until "Add a response" is clicked, then
    // indexed rows. Same shape as the I-130's additional-information table, but
    // the array is named `additionalInformationArray` (not ...Table).
    slug: "/additional-information/additional-information",
    title: "Additional information",
    kind: "form",
    repeater: {
      namePrefix: "additionalInformationArray",
      addButtonText: "add a response",
    },
    fields: [
      t("additionalInformationArray.{i}.section"),
      t("additionalInformationArray.{i}.page"),
      t("additionalInformationArray.{i}.question"),
      area("additionalInformationArray.{i}.response"),
    ],
  },

  // ── Review and Submit ────────────────────────────────────────────────────
  // NOT CAPTURED — see "KNOWN GAPS" at the top of this file. Deliberately absent
  // rather than guessed; fill-chain's Submit/Pay/e-sign guard is the backstop.
];
