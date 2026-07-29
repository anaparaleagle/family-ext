// ===========================================================================
// I-539 STRUCTURAL DESCRIPTOR — page order, URL slugs, per-field kind, repeater
// flags, upload-only pages. Authored from paraleagle-dev/i539-online-field-dump/
// (24 primary screens f1-cos/00..23 + the reason/status delta captures in
// f1-eos, b1b2, j1, h4, l2; captured live 2026-07-15 — screens 00..22b on
// throwaway draft 13212561, the review screen on throwaway draft 13218429).
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
//  - THE REVIEW PAGE IS NOW CAPTURED (2026-07-15, draft 13218429, f1-cos/23):
//    slug /review-and-submit/review-your-application, no inputs, and the walk
//    terminates on it. It was reached by clicking the sidebar link on a BRAND-NEW
//    empty draft — it does not bounce to the form start, so unlike the I-130 it
//    has no anti-deep-linking prerequisite. Review is ONE screen; the statement /
//    signature / pay-and-submit steps are separate routes below it that we never
//    visit. See the entry at the bottom of I539_PAGES for the safety rationale.
//
// KNOWN GAPS (honest — do not paper over):
//  1. The six GATING `formikFactoryUIMeta.*` toggles ("...none" /
//     "noTravelDocumentNumber" / "noEmail") are now DRIVEN as check(...) fields
//     from the backend map, so a Fill-all no longer STALLS on a blank A-Number /
//     SSN / USCIS# / passport / travel-doc / email. The REMAINING
//     `formikFactoryUIMeta.*` toggles stay in I539_SKIP — the user answers those.
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

import { FormPage, area, check, cond, phone, radio, search, t } from "../runner/types";

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
 *    FACT data (the I-130 leaves the same class of toggle unmapped). What is left
 *    here is the preparer/interpreter "no business / no email" meta plus
 *    sameAsDaytimePhone. (SOF-892 moved the preparer REVEAL toggles OUT of this
 *    list — see group 2 — because the backend now drives them from firm data.)
 *
 *    HISTORY, because the reasoning was right and then went stale: the six GATING
 *    "I do not have my X" checkboxes (`...alienNumber.none`,
 *    `socialSecurityNumber.none`, `uscisNumber.none`, `recentEntry.passport.none`,
 *    `recentEntry.noTravelDocumentNumber`, `contactInformation.noEmail`) used to
 *    sit here, on the grounds that "the backend map does not exist yet, so there
 *    is no resolved value that could decide it". The map DOES exist now and sends
 *    all six (each a {checkbox, equals:"", on:"true"} entry that ticks the box
 *    when its backing fact is blank). Leaving them skipped meant a Fill-all
 *    STALLED: if the applicant genuinely has no A-Number, the online form needs
 *    `...alienNumber.none` CHECKED before Next enables, so the run stopped there
 *    until a human ticked the box — and it stopped BEFORE the evidence pages, so
 *    no document uploaded either. They are now driven as `check(...)` on their
 *    pages.
 *
 *    planPageFill only fills names that appear in a page's `fields`, so anything
 *    still in this list is permanently left to the user — which is right for what
 *    remains. The descriptor<->backend guard in test/i539-coverage.test.ts now
 *    fails if a name is ever in BOTH this list and the backend map again.
 *
 * 2. `gettingStarted.preparer.*` — the firm's own preparer identity. SOF-892:
 *    these are now DRIVEN from the firm's G-28 attorney block (backend map
 *    firm.* -> preparer given/family name, business, daytime phone, email — the
 *    same source the paper I-539 Part 7 fills), plus the three reveal toggles on
 *    the preparer-and-interpreter page (a preparer IS assisting, no interpreter)
 *    so the preparer section opens and its required name + business are no longer
 *    left blank. SOF-1004 then added the preparer MOBILE + its "no mobile" tick
 *    once the backend gained firm.mobile_phone to send.
 *    `gettingStarted.interpreter.*` also stays skipped — a
 *    firm-prepared case uses no interpreter — with its PAGE kept in the
 *    descriptor (empty `fields`) so the walk steps past it cleanly.
 */
export const I539_SKIP: string[] = [
  // 1. UI-meta toggles — the user answers these. (The three preparer reveal
  //    toggles hasHelper / helper.hasPreparer / helper.hasInterpreter moved OUT
  //    to the preparer-and-interpreter page's `fields` — SOF-892 drives them.)
  "formikFactoryUIMeta.gettingStarted.preparer.noBusiness",
  "formikFactoryUIMeta.gettingStarted.preparer.contact.noEmailAddress",
  "formikFactoryUIMeta.gettingStarted.interpreter.noBusiness",
  "formikFactoryUIMeta.gettingStarted.interpreter.contact.noMobilePhone",
  "formikFactoryUIMeta.gettingStarted.interpreter.contact.noEmailAddress",
  "formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.sameAsDaytimePhone",
  // The six GATING toggles that used to sit here are now DRIVEN as check(...) on
  // "Your contact information", "Your immigration information" and "Other
  // information" — see the HISTORY note above.

  // 2. Interpreter identity — left to the user.
  //    SOF-892 moved the preparer given/family name, business, daytime phone and
  //    email OUT to /getting-started/preparer's `fields` (driven from firm.*), and
  //    SOF-1004 moved the MOBILE + its "no mobile" tick out too, once the backend
  //    started sending firm.mobile_phone.
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
      // misc/changeOfStatus-target-options.json. Revealed by choosing "a change
      // of status" (03 -> 03b).
      cond(search("gettingStarted.reasonForRequest.statusInfo.changeOfStatus"), {
        by: "gettingStarted.reasonForRequest.applicationType",
        is: "changeOfStatus",
      }),
      cond(t("gettingStarted.reasonForRequest.statusInfo.dateOfChange"), {
        by: "gettingStarted.reasonForRequest.applicationType",
        is: "changeOfStatus",
      }),
      t("gettingStarted.reasonForRequest.requestedDateOfExtension"),
      // Doc 2.3, a repeated request: "Would you like to request Premium
      // Processing Service?" was never answered because the descriptor had no
      // entry for it, even though the backend has been sending the answer from
      // applicant.want_premium all along. Half-fixed reads as not fixed — the
      // question stayed blank on USCIS.
      //
      // Field name captured live 2026-07-28. Sits directly below
      // requestedDateOfExtension.
      //
      // TWO-STAGE REVEAL, which is why it needs revealedBy and not a bare cond():
      // picking "a change of status" is not enough — the radio stays out of the
      // DOM until the change-to TARGET is set, and only premium-eligible targets
      // (F/M/J) render it at all. So it is revealed by the target, not by the
      // application type. `is` is omitted deliberately: ANY target may reveal it,
      // and which ones do is USCIS's business, not ours to hardcode.
      //
      // Ordering matters more than it looks: this is a RADIO revealed by a SEARCH
      // field. The old radios-first rule would drive it before the target existed
      // and fail every run — see orderFields in fill-chain.ts.
      //
      // A blank want_premium leaves the radio UNSET. The backend's i539_yesno
      // already returns "" for a blank and planPageFill drops empty values, so
      // there is nothing to add here — and deliberately no default. Guessing "No"
      // on a premium request is not ours to guess.
      cond(radio("formikFactoryUIMeta.gettingStarted.reasonForRequest.premiumProcessing", ["true", "false"]), {
        by: "gettingStarted.reasonForRequest.statusInfo.changeOfStatus",
      }),
    ],
  },
  {
    // f1-cos/04 + 04b. The reveal toggles (SOF-892): "someone is assisting"
    // (hasHelper) + "a preparer is assisting" (helper.hasPreparer) open the
    // preparer section; "an interpreter is assisting" (helper.hasInterpreter) is
    // answered No. Driven from firm data so the downstream preparer page reveals.
    slug: "/getting-started/preparer-and-interpreter-information",
    title: "Preparer and interpreter information",
    kind: "form",
    fields: [
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper", [
        "true",
        "false",
      ]),
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer", [
        "true",
        "false",
      ]),
      radio(
        "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter",
        ["true", "false"],
      ),
    ],
  },
  {
    // f1-cos/05. Reached because the reveal toggles above are driven to Yes.
    // SOF-892: the firm's G-28 attorney IS the preparer, so these fill from the
    // backend's firm.* block (the same source the paper I-539 Part 7 uses). The
    // "no business / no mobile / no email" meta + the mobile phone stay in
    // I539_SKIP (no firm mobile source; the firm always has a business).
    slug: "/getting-started/preparer",
    title: "Preparer information",
    kind: "form",
    conditional: true,
    fields: [
      t("gettingStarted.preparer.name.firstName"),
      t("gettingStarted.preparer.name.lastName"),
      t("gettingStarted.preparer.business"),
      phone("gettingStarted.preparer.contact.daytimePhone"),
      // SOF-1004: the backend now sends firm.mobile_phone (digits-only, same as
      // the daytime phone). USCIS requires the number OR the "no mobile" tick, so
      // the backend resolves the tick off the SAME fact — blank gives "true", a
      // number gives "". Both must be driven or the required field holds the page.
      phone("gettingStarted.preparer.contact.mobilePhone"),
      check("formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone"),
      t("gettingStarted.preparer.contact.emailAddress"),
    ],
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
      // GATE: USCIS wants the email OR this tick, never neither — a blank
      // required field holds the page. The backend ticks it when
      // applicant.email is blank.
      check("formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.noEmail"),
      t("applicant.yourContactInformation.mailingAddress.inCareOfName"),
      t("applicant.yourContactInformation.mailingAddress.addressLineOne"),
      t("applicant.yourContactInformation.mailingAddress.addressLineTwo"),
      t("applicant.yourContactInformation.mailingAddress.city"),
      search("applicant.yourContactInformation.mailingAddress.state"),
      t("applicant.yourContactInformation.mailingAddress.zipCode"),
      radio("applicant.yourContactInformation.isMailingEqualToPhysical", ["true", "false"]),
      // The US physical-address block, revealed by answering "no" to "is your
      // mailing address the same as your physical address?" (08 -> 08b).
      //
      // These five read 5 FAILED on the 2026-07-28 run ("element not on page"),
      // and NOT because of ordering — the radio was never in the payload at all,
      // so nothing opened the block. See the backend map note: the entry for
      // isMailingEqualToPhysical is checkbox-shaped and can only emit "true" or
      // blank, never "false". Declaring the reveal here means that case now reads
      // as "not attempted, nothing answered the question" instead of five
      // failures with no cause attached.
      ...[
        t("applicant.yourContactInformation.physicalAddresses.addressLineOne"),
        t("applicant.yourContactInformation.physicalAddresses.addressLineTwo"),
        t("applicant.yourContactInformation.physicalAddresses.city"),
        search("applicant.yourContactInformation.physicalAddresses.state"),
        t("applicant.yourContactInformation.physicalAddresses.zipCode"),
      ].map((f) =>
        cond(f, { by: "applicant.yourContactInformation.isMailingEqualToPhysical", is: "false" }),
      ),
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
      // GATE: passport number OR this tick. Backend ticks it when
      // applicant.passport_number is blank.
      check(
        "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.passport.none",
      ),
      t("applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.travelDocumentNumber"),
      // GATE: travel-document number OR this tick. Most applicants have no
      // travel document, so this is the common path, not the edge case.
      check(
        "formikFactoryUIMeta.applicant.yourImmigrationInformation.yourImmigrationInformation1.recentEntry.noTravelDocumentNumber",
      ),
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
      // Each number is GATED by its own "I do not have or know my X" tick: USCIS
      // wants the number OR the tick, never neither. Most I-539 applicants have
      // no A-Number and no USCIS account number, so without these ticks the walk
      // stalled here on almost every case — and this page sits BEFORE the
      // evidence pages, so nothing uploaded either. The backend ticks each one
      // when its backing fact is blank.
      t("applicant.otherInformation.alienNumber.number"),
      check("formikFactoryUIMeta.applicant.otherInformation.alienNumber.none"),
      t("applicant.otherInformation.socialSecurityNumber.number"),
      check("formikFactoryUIMeta.applicant.otherInformation.socialSecurityNumber.none"),
      t("applicant.otherInformation.uscisNumber.number"),
      check("formikFactoryUIMeta.applicant.otherInformation.uscisNumber.none"),
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
      // The principal's-petition block. The 17b capture shows all five of these
      // revealed together by ONE answer — basedOnSeparateFamilyPetition being
      // anything other than "no". It is NOT a second stage behind selectedFormType.
      //
      // Four of these read 0/4 filled on the 2026-07-28 run: we held the
      // principal's receipt number, name and filing date (they come off the
      // principal party), but the case had no answer to the question that opens
      // the block, so the inputs were never in the DOM. With the reveal declared,
      // that case is now reported as "not attempted" with the reason, and the
      // fields fill as soon as the questionnaire answer is present.
      ...[
        radio("yourApplication.informationAboutRequest.informationAboutRequestPage1.selectedFormType", [
          "formI129",
          "formI539",
        ]),
        t(
          "yourApplication.informationAboutRequest.informationAboutRequestPage1.separatePetitionReceiptNumber.receiptNumber",
        ),
        t("yourApplication.informationAboutRequest.informationAboutRequestPage1.fullName.firstName"),
        t("yourApplication.informationAboutRequest.informationAboutRequestPage1.fullName.lastName"),
        t("yourApplication.informationAboutRequest.informationAboutRequestPage1.dateFiled"),
      ].map((f) =>
        cond(f, {
          by: "yourApplication.informationAboutRequest.informationAboutRequestPage1.basedOnSeparateFamilyPetition",
          is: ["filedWithThisI539", "filedPreviouslyAndPending"],
        }),
      ),
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
    // REQUIRED for F/M targets — myUSCIS inserts an I-20 upload page right after
    // the I-94, and the backend routes doc_type form_i20 to it. PROVEN live on
    // 2026-07-17 (F-1 COS) and again 2026-07-28 (draft 13352536, F-2), where the
    // walk logged "page not in descriptor … skipping past it" and the I-20 never
    // reached USCIS.
    //
    // NOTE THE CAPITAL I. Its neighbours are lower-case and page detection is a
    // case-sensitive path-suffix match, so "form-i-20" would silently never
    // match and the page would keep being skipped.
    //
    // The f1-cos capture (dump 19-evidence-form-i94.json) shows an Evidence
    // sidebar WITHOUT this slot, which nearly got the page dropped from the
    // backend feed as a phantom. Two live runs say it is real; the likeliest
    // explanation is that the captured draft had not answered enough to reveal
    // it. Worth a note if anyone re-captures.
    slug: "/evidence/form-I-20",
    title: "Form I-20",
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
  {
    // f1-cos/23. THE WALK STOPS HERE (fillAll breaks on kind === "review").
    // Captured live 2026-07-15 (draft 13218429). No inputs at all: the page is a
    // fee summary ($420) plus one red "There are errors in <section>" alert per
    // incomplete section, each with an "Edit my responses" button.
    //
    // SAFETY — why this entry is load-bearing, not bookkeeping: the control that
    // advances PAST review is a plain "Next" (id=button-button,
    // data-testid=next-button), identical to every other page's, so the
    // NEVER_CLICK_TEXT guard cannot catch it and findNextButton() matches it on
    // its first selector. It is disabled ONLY while red alerts remain — a
    // successful autofill clears them, which is exactly when it goes live. This
    // descriptor entry is the primary stop; fill-chain's onTerminalPath() covers
    // the slug-drift case. Downstream (never visited, read from the myUSCIS
    // route table): /review-and-submit/your-statement, /your-signature,
    // /representative-signature, /pay-and-submit.
    slug: "/review-and-submit/review-your-application",
    title: "Review your application",
    kind: "review",
    fields: [],
  },
];
