// ===========================================================================
// N-400 STRUCTURAL DESCRIPTOR — page order, URL slugs, per-field kind, repeater
// flags, upload-only pages.
//
// Authored from the live capture vendored at
// test/fixtures/n400-online-field-dump/ (draft 13370795, 2026-07-30). Every name,
// slug and option code below was read off the running form; nothing is inferred.
// test/n400-coverage.test.ts holds this file to that capture.
//
// Form: N-400, Application for Naturalization.
// Host: https://my.uscis.gov/forms/application-for-naturalization/<draftId>/<slug>
//
// WHAT THE CAPTURE ESTABLISHED (facts, not assumptions):
//  - Same React/Formik/MUI platform as the I-130 and I-539, so the engine
//    value-setter and the Formik bridge drive it unchanged.
//  - ONE party. `applicant.*` IS our applicant. There is NO applicant/beneficiary
//    inversion — that is an I-130-only trap.
//  - FOUR top-level namespaces, not one: gettingStarted.*, applicant.*,
//    yourFamily.*, moralCharacter.* (plus formikFactoryUIMeta.* toggles). A map
//    written as if everything were applicant.* misses two thirds of the form.
//  - The page HEADING is identical on every screen, so the URL slug is the only
//    detection signal. Titles below are the sidebar labels, for logging.
//  - THE PAGE SET IS NOT FIXED. It grows from 37 slugs on a blank draft to 52 as
//    answers are COMMITTED with Next, and it also SHRINKS (switching Married ->
//    Divorced removes both current-spouse pages). Reachability is therefore
//    per-scenario: a page declared here being absent is normal, not a failure.
//
// THE DERIVED EXPLAIN RULE (this is why the moral-character section is short):
//  Every moral-character field named `<x>.question` has a sibling
//  `<x>.additionalExplanation` textarea revealed by answering Yes; a field
//  WITHOUT the `.question` suffix has no explain sibling. Proven live on four
//  fields with a negative control. The `q()` helper below expands one call into
//  both entries, so the rule is encoded once instead of copied 39 times.
//
// KNOWN GAPS (honest — do not paper over):
//  1. The current-address "To" date has a RANDOM UUID for a name
//     (`8742c00f-...` on the capture run), not a Formik path. It cannot be
//     declared here and cannot be filled by name. It needs label matching
//     ("To (MM/DD/YYYY)"). Listed in N400_SKIP with that reason.
//  2. The five RACE checkboxes have BARE NUMERIC names ("1","2","3","5","6") with
//     no Formik path. They ARE declared below by those exact names, but that a
//     write to `[name="1"]` actually registers is UNVERIFIED — it was never
//     exercised on a live fill. Confirm before trusting race output.
//  3. `employmentInfo.occupation` is a CLOSED list of 29 USCIS categories, not
//     free text. Our fact is free text, so the backend must classify it. Driving
//     the raw value will not commit.
//  4. Prior-marriage DETAIL cannot be filed online at all — the form only asks
//     how many times, and takes the substance as documents. Paper facts have
//     nowhere to go.
// ===========================================================================

import {
  DescriptorField,
  FormPage,
  area,
  check,
  cond,
  phone,
  radio,
  search,
  t,
} from "../runner/types";

/** Every yes/no radio on this form uses these two values. */
const YN = ["true", "false"];

/**
 * A moral-character question plus its derived explanation field.
 *
 * Expands `<base>` into the `.question` radio and the `.additionalExplanation`
 * textarea that Yes reveals. The explanation carries `revealedBy` so the chain
 * drives the radio first, waits for the textarea to render, and can tell a
 * legitimate non-reveal (answer was No) from a broken one.
 */
const q = (base: string): DescriptorField[] => [
  radio(`${base}.question`, YN),
  cond(area(`${base}.additionalExplanation`), { by: `${base}.question`, is: "true" }),
];

/**
 * Captured field names this descriptor deliberately does NOT drive. The coverage
 * test asserts nothing falls between "driven" and "skipped", so this list is the
 * reviewed record of what we leave alone.
 */
export const N400_SKIP: string[] = [
  // The current-address "To" date. Its name is a RANDOM UUID generated per
  // render, so there is no stable selector — see gap 1 in the header. A guessed
  // name would silently fill nothing, which is worse than a declared gap.
  // (Excluded from the coverage comparison anyway, since it has no dotted path.)
];

export const N400_PAGES: FormPage[] = [
  // ── Getting Started ─────────────────────────────────────────────────────
  {
    slug: "/getting-started/basis-of-eligibility",
    title: "Basis of eligibility",
    kind: "form",
    fields: [
      // OPAQUE, NON-SEQUENTIAL codes — 189 sits THIRD on screen. Our
      // applicant.eligibility_basis maps general_5yr=191, spouse_3yr=192,
      // other=195; the rest are bases our product does not model.
      radio("gettingStarted.changeBasisForEligibility.eligibilityCode", [
        "191", "192", "189", "193", "194", "190", "195",
      ]),
    ],
  },
  {
    slug: "/getting-started/preparer-and-interpreter-information",
    title: "Preparer and interpreter information",
    kind: "form",
    fields: [
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper", YN),
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer", YN),
      radio("formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter", YN),
    ],
  },
  {
    // Field-for-field IDENTICAL to the I-539 preparer page, so the I-539 backend
    // map entries transfer verbatim (including the SOF-1004 mobile pair).
    slug: "/getting-started/preparer",
    title: "Preparer information",
    kind: "form",
    conditional: true,
    fields: [
      t("gettingStarted.preparer.name.firstName"),
      t("gettingStarted.preparer.name.lastName"),
      check("formikFactoryUIMeta.gettingStarted.preparer.noBusiness"),
      t("gettingStarted.preparer.business"),
      phone("gettingStarted.preparer.contact.daytimePhone"),
      check("formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone"),
      phone("gettingStarted.preparer.contact.mobilePhone"),
      check("formikFactoryUIMeta.gettingStarted.preparer.contact.noEmailAddress"),
      t("gettingStarted.preparer.contact.emailAddress"),
    ],
  },
  {
    // Mirrors the preparer page, plus `language`. Revealed by hasInterpreter.
    slug: "/getting-started/interpreter",
    title: "Interpreter information",
    kind: "form",
    conditional: true,
    fields: [
      t("gettingStarted.interpreter.name.firstName"),
      t("gettingStarted.interpreter.name.lastName"),
      check("formikFactoryUIMeta.gettingStarted.interpreter.noBusiness"),
      t("gettingStarted.interpreter.business"),
      phone("gettingStarted.interpreter.contact.daytimePhone"),
      check("formikFactoryUIMeta.gettingStarted.interpreter.contact.noMobilePhone"),
      phone("gettingStarted.interpreter.contact.mobilePhone"),
      check("formikFactoryUIMeta.gettingStarted.interpreter.contact.noEmailAddress"),
      t("gettingStarted.interpreter.contact.emailAddress"),
      t("gettingStarted.interpreter.language"),
    ],
  },

  // ── About You ───────────────────────────────────────────────────────────
  {
    slug: "/about-you/your-name",
    title: "Your name",
    kind: "form",
    fields: [
      t("applicant.yourName.name.firstName"),
      t("applicant.yourName.name.middleName"),
      t("applicant.yourName.name.lastName"),
      radio("formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", YN),
      // Same repeater name and shape as the I-130's, so that map block transfers.
      cond(t("applicant.yourName.additionalNames.otherNames.{i}.firstName"), {
        by: "formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", is: "true",
      }),
      cond(t("applicant.yourName.additionalNames.otherNames.{i}.middleName"), {
        by: "formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", is: "true",
      }),
      cond(t("applicant.yourName.additionalNames.otherNames.{i}.lastName"), {
        by: "formikFactoryUIMeta.applicant.yourName.additionalNames.hasAdditionalNames", is: "true",
      }),
      radio("applicant.yourName.nameChangedName.hasNameChanged", YN),
      cond(t("applicant.yourName.nameChangedName.nameChange.firstName"), {
        by: "applicant.yourName.nameChangedName.hasNameChanged", is: "true",
      }),
      cond(t("applicant.yourName.nameChangedName.nameChange.middleName"), {
        by: "applicant.yourName.nameChangedName.hasNameChanged", is: "true",
      }),
      cond(t("applicant.yourName.nameChangedName.nameChange.lastName"), {
        by: "applicant.yourName.nameChangedName.hasNameChanged", is: "true",
      }),
    ],
    repeater: {
      namePrefix: "applicant.yourName.additionalNames.otherNames",
      addButtonText: "add another name",
    },
  },
  {
    slug: "/about-you/your-contact-information",
    title: "Your contact information",
    kind: "form",
    fields: [
      phone("applicant.yourContactInformation.contactInformation.daytimePhone"),
      check("formikFactoryUIMeta.applicant.yourContactInformation.contactInformation.sameAsDaytimePhone"),
      phone("applicant.yourContactInformation.contactInformation.mobilePhone"),
      t("applicant.yourContactInformation.contactInformation.emailAddress"),
      t("applicant.yourContactInformation.physicalAddress.inCareOfName"),
      search("applicant.yourContactInformation.physicalAddress.country"),
      t("applicant.yourContactInformation.physicalAddress.addressLineOne"),
      t("applicant.yourContactInformation.physicalAddress.addressLineTwo"),
      t("applicant.yourContactInformation.physicalAddress.city"),
      // The state list Title-Cases every word: "District Of Columbia" with a
      // capital "Of". Reference data says "of", so the value must be normalised
      // or the listbox never commits.
      search("applicant.yourContactInformation.physicalAddress.state"),
      t("applicant.yourContactInformation.physicalAddress.zipCode"),
      t("applicant.yourContactInformation.physicalAddress.datesOfResidence.fromDate"),
      // NOTE: the matching "To" date is the UUID-named field — see N400_SKIP.
      // CHECKBOX-shaped, so it can only ever emit "true" or blank, never "false".
      // The same shape was a live bug on both the I-130 and I-539; map it with
      // the {checkbox, equals, on} entry form, not as a radio.
      check("applicant.yourContactInformation.mailingAddress.isMailingSameAsPhysical"),
      t("applicant.yourContactInformation.mailingAddress.address.inCareOfName"),
      search("applicant.yourContactInformation.mailingAddress.address.country"),
      t("applicant.yourContactInformation.mailingAddress.address.addressLineOne"),
      t("applicant.yourContactInformation.mailingAddress.address.addressLineTwo"),
      t("applicant.yourContactInformation.mailingAddress.address.city"),
      search("applicant.yourContactInformation.mailingAddress.address.state"),
      t("applicant.yourContactInformation.mailingAddress.address.zipCode"),
    ],
  },
  {
    slug: "/about-you/where-you-have-lived",
    title: "Where you have lived",
    kind: "form",
    fields: [
      search("applicant.whereYouHaveLived.{i}.address.country"),
      t("applicant.whereYouHaveLived.{i}.address.addressLineOne"),
      t("applicant.whereYouHaveLived.{i}.address.addressLineTwo"),
      t("applicant.whereYouHaveLived.{i}.address.city"),
      search("applicant.whereYouHaveLived.{i}.address.state"),
      t("applicant.whereYouHaveLived.{i}.address.zipCode"),
      t("applicant.whereYouHaveLived.{i}.datesOfResidence.fromDate"),
      // Unlike the current-address block above, THIS toDate has a real name.
      t("applicant.whereYouHaveLived.{i}.datesOfResidence.toDate"),
    ],
    repeater: {
      namePrefix: "applicant.whereYouHaveLived",
      addButtonText: "add an address",
      rowCommitButtonText: "Save entry",
    },
  },
  {
    slug: "/about-you/requests-for-accommodations",
    title: "Requests for accommodations",
    kind: "form",
    fields: [
      // This is the N-648 / English-exemption question, NOT "do you need an
      // accommodation" — the distinction SOF-1066 is correcting on the PDF side.
      radio("applicant.requestsForAccommodations.disabilityPreventingKnowingEnglish", YN),
    ],
  },
  {
    slug: "/about-you/when-and-where-you-were-born",
    title: "When and where you were born",
    kind: "form",
    fields: [
      t("applicant.whenAndWhereYouWereBorn.dateOfBirth"),
      radio("applicant.whenAndWhereYouWereBorn.parentUSCitizen", YN),
      search("applicant.whenAndWhereYouWereBorn.countryOfBirth"),
    ],
  },
  {
    slug: "/about-you/your-immigration-information",
    title: "Your immigration information",
    kind: "form",
    fields: [
      search("applicant.yourImmigrationInformation.countryOfCitizenship"),
      // Gating ".none" toggles MUST be driven. Leaving the I-539's equivalents
      // skipped made Fill-all STALL on a blank A-Number, before the evidence
      // pages, so no document uploaded either.
      check("formikFactoryUIMeta.applicant.yourImmigrationInformation.datePermResident.none"),
      t("applicant.yourImmigrationInformation.datePermResident.date"),
      t("applicant.yourImmigrationInformation.alienNumber.number"),
    ],
  },
  {
    slug: "/about-you/your-immigration-information/your-immigration-information-page-2",
    title: "Your immigration information page 2",
    kind: "form",
    fields: [
      radio("applicant.yourImmigrationInformationPage2.wantSocialSecurityCard", YN),
      // PDF Part 2 Item 12.c — the SSA consent. A Yes on 12.a with a blank 12.c
      // means no card is issued, which is why SOF-1066 adds it.
      cond(radio("applicant.yourImmigrationInformationPage2.consentForDisclosure", YN), {
        by: "applicant.yourImmigrationInformationPage2.wantSocialSecurityCard", is: "true",
      }),
      check("formikFactoryUIMeta.applicant.yourImmigrationInformationPage2.socialSecurityNumber.socialSecurityNumber.none"),
      t("applicant.yourImmigrationInformationPage2.socialSecurityNumber.socialSecurityNumber.number"),
      check("formikFactoryUIMeta.applicant.yourImmigrationInformationPage2.uscisAccountNumber.none"),
      t("applicant.yourImmigrationInformationPage2.uscisAccountNumber.number"),
    ],
  },
  {
    slug: "/about-you/describe-yourself",
    title: "Describe yourself",
    kind: "form",
    fields: [
      // 3=Male / 1=Female. Reads backwards but matches the I-130, so it is a
      // myUSCIS-wide convention rather than a one-off.
      radio("applicant.describeYourself.gender", ["3", "1"]),
      radio("applicant.describeYourself.ethnicity", ["1", "2"]),
      // RACE — bare numeric names, no Formik path, and NO code 4 exists.
      // Declared by exact name; that a write registers here is UNVERIFIED.
      check("1"), // White
      check("2"), // Asian
      check("3"), // Black or African American
      check("5"), // American Indian or Alaska Native
      check("6"), // Native Hawaiian or Other Pacific Islander
      search("applicant.describeYourself.height.feet"),
      search("applicant.describeYourself.height.inches"),
      t("applicant.describeYourself.weight"),
      // Byte-exact option text: "Blonde" not Blond, "Bald (no hair)",
      // "Unknown/Other", "Gray" not Grey.
      search("applicant.describeYourself.eyeColor"),
      search("applicant.describeYourself.hairColor"),
    ],
  },
  {
    slug: "/about-you/schools-and-employment",
    title: "Schools and employment",
    kind: "form",
    fields: [
      // The row renders ONLY this field until a type is chosen; each type then
      // reveals a different set. See the repeater's `variants`.
      search("applicant.schoolsAndEmployment.{i}.schoolOrEmploymentType"),
      cond(t("applicant.schoolsAndEmployment.{i}.employmentInfo.workName")),
      // CLOSED list of 29 USCIS categories — a free-text occupation will not commit.
      cond(search("applicant.schoolsAndEmployment.{i}.employmentInfo.occupation")),
      cond(t("applicant.schoolsAndEmployment.{i}.schoolInfo.schoolName")),
      cond(t("applicant.schoolsAndEmployment.{i}.schoolInfo.fieldOfStudy")),
      t("applicant.schoolsAndEmployment.{i}.dates.fromDate"),
      check("applicant.schoolsAndEmployment.{i}.dates.toPresent"),
      t("applicant.schoolsAndEmployment.{i}.dates.toDate"),
      cond(search("applicant.schoolsAndEmployment.{i}.address.country")),
      cond(t("applicant.schoolsAndEmployment.{i}.address.city")),
      cond(search("applicant.schoolsAndEmployment.{i}.address.state")),
      cond(t("applicant.schoolsAndEmployment.{i}.address.zipCode")),
    ],
    repeater: {
      namePrefix: "applicant.schoolsAndEmployment",
      addButtonText: "add entry",
      rowCommitButtonText: "Save entry",
      variants: {
        discriminator: "applicant.schoolsAndEmployment.{i}.schoolOrEmploymentType",
        // Keys are the exact autocomplete option text. The shapes are NOT
        // supersets of each other: unemployment has no address and no occupation,
        // and school swaps employmentInfo.* for schoolInfo.*.
        shapes: {
          "Add an employer": [
            "employmentInfo.workName", "employmentInfo.occupation",
            "dates.fromDate", "dates.toPresent", "dates.toDate",
            "address.country", "address.city", "address.state", "address.zipCode",
          ],
          "Add a period of self-employment": [
            "employmentInfo.workName", "employmentInfo.occupation",
            "dates.fromDate", "dates.toPresent", "dates.toDate",
            "address.country", "address.city", "address.state", "address.zipCode",
          ],
          "Add a period of unemployment": [
            "employmentInfo.workName", "dates.fromDate", "dates.toPresent", "dates.toDate",
          ],
          "Add a school": [
            "schoolInfo.schoolName", "schoolInfo.fieldOfStudy",
            "dates.fromDate", "dates.toPresent", "dates.toDate",
            "address.country", "address.city", "address.state", "address.zipCode",
          ],
        },
      },
    },
  },
  {
    slug: "/about-you/travel-outside-the-us",
    title: "Travel outside the U.S.",
    kind: "form",
    fields: [
      radio("formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years", YN),
      cond(t("applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.dateLeftTheUS"), {
        by: "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years", is: "true",
      }),
      cond(t("applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.dateReturnedToUS"), {
        by: "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years", is: "true",
      }),
      // NESTED list — one row can hold several countries, each its own {j}.
      cond(search("applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.countries.{j}"), {
        by: "formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years", is: "true",
      }),
    ],
    repeater: {
      namePrefix: "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable",
      addButtonText: "add trip",
      rowCommitButtonText: "Save entry",
      nested: {
        namePrefix:
          "applicant.travelOutsideTheUs.timeSpentOutsideUS.timeSpentOutsideUSTable.{i}.countries",
        addButtonText: "Add country",
      },
    },
  },

  // ── Your Family ─────────────────────────────────────────────────────────
  {
    slug: "/your-family/marital-status",
    title: "Marital status",
    kind: "form",
    fields: [
      // Separated is 7. Code 5 is Marriage annulled. Positional guessing files
      // the wrong status.
      radio("yourFamily.maritalStatus.status", ["1", "2", "3", "4", "7", "5"]),
      cond(radio("yourFamily.maritalStatus.memberOfArmedForces", YN), {
        by: "yourFamily.maritalStatus.status", is: "2",
      }),
      t("yourFamily.maritalStatus.numberOfTimesMarried"),
    ],
  },
  {
    // Revealed ONLY by Married (2). Separated does NOT reveal it, even though a
    // separated applicant still has a spouse.
    slug: "/your-family/current-spouse",
    title: "Current spouse",
    kind: "form",
    conditional: true,
    fields: [
      t("yourFamily.currentSpouse.currentSpouse1.name.firstName"),
      t("yourFamily.currentSpouse.currentSpouse1.name.middleName"),
      t("yourFamily.currentSpouse.currentSpouse1.name.lastName"),
      t("yourFamily.currentSpouse.currentSpouse1.dateOfBirth"),
      t("yourFamily.currentSpouse.currentSpouse1.dateOfMarriage"),
      // A RADIO here, unlike the applicant's own mailing control — so this one
      // CAN express "false". No repeat of the checkbox bug on this field.
      radio("yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", YN),
      cond(search("yourFamily.currentSpouse.currentSpouse1.physicalAddress.country"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
      cond(t("yourFamily.currentSpouse.currentSpouse1.physicalAddress.addressLineOne"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
      cond(t("yourFamily.currentSpouse.currentSpouse1.physicalAddress.addressLineTwo"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
      cond(t("yourFamily.currentSpouse.currentSpouse1.physicalAddress.city"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
      cond(search("yourFamily.currentSpouse.currentSpouse1.physicalAddress.state"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
      cond(t("yourFamily.currentSpouse.currentSpouse1.physicalAddress.zipCode"), {
        by: "yourFamily.currentSpouse.currentSpouse1.isPhysicalAddressSame", is: "false",
      }),
    ],
  },
  {
    // `currentSpouse1` / `currentSpouse2` is the PAGE number, NOT a second
    // spouse. Reading it the other way models the data completely wrong.
    slug: "/your-family/current-spouse/current-spouse-page-2",
    title: "Current spouse page 2",
    kind: "form",
    conditional: true,
    fields: [
      radio("yourFamily.currentSpouse.currentSpouse2.spouseBecameCitizen", ["byBirth", "other"]),
      cond(t("yourFamily.currentSpouse.currentSpouse2.dateSpouseBecameCitizen"), {
        by: "yourFamily.currentSpouse.currentSpouse2.spouseBecameCitizen", is: "other",
      }),
      check("formikFactoryUIMeta.yourFamily.currentSpouse.currentSpouse2.currentSpouseANumber.none"),
      t("yourFamily.currentSpouse.currentSpouse2.currentSpouseANumber.number"),
      t("yourFamily.currentSpouse.currentSpouse2.numberOfTimesMarried"),
    ],
  },
  {
    slug: "/your-family/children",
    title: "Children",
    kind: "form",
    fields: [
      t("yourFamily.children.totalNumberOfChildren"),
      t("yourFamily.children.childrenInformation.{i}.childInfo.name.firstName"),
      t("yourFamily.children.childrenInformation.{i}.childInfo.name.lastName"),
      t("yourFamily.children.childrenInformation.{i}.childInfo.dateOfBirth"),
      // FULL DISPLAY TEXT as the code, and for the third option the code
      // ("Unknown") differs from the label ("Unknown/Missing").
      radio("yourFamily.children.childrenInformation.{i}.childInfo.residence", [
        "Resides with me", "Does not reside with me", "Unknown",
      ]),
      radio("yourFamily.children.childrenInformation.{i}.childInfo.relationship", [
        "Biological son or daughter", "Stepchild", "Legally adopted son or daughter",
      ]),
      radio("yourFamily.children.childrenInformation.{i}.childInfo.supportForChild", YN),
    ],
    repeater: {
      namePrefix: "yourFamily.children.childrenInformation",
      addButtonText: "add a child",
      rowCommitButtonText: "Save child",
    },
  },

  // ── Moral Character ─────────────────────────────────────────────────────
  {
    slug: "/moral-character/citizenship-claims-and-voting",
    title: "Citizenship claims and voting",
    kind: "form",
    fields: [
      ...q("moralCharacter.citizenshipClaimsAndVoting.claimedUSCitizenship"),
      ...q("moralCharacter.citizenshipClaimsAndVoting.registeredToVote"),
    ],
  },
  {
    slug: "/moral-character/hereditary-or-inherited-titles",
    title: "Hereditary or inherited titles",
    kind: "form",
    fields: [
      ...q("moralCharacter.hereditaryOrInheritedTitles.titleOfNobility"),
      // Extra radio with no counterpart in SOF-1066's PDF list — worth checking
      // whether the paper form carries it.
      cond(radio("moralCharacter.hereditaryOrInheritedTitles.willingToGiveUpTitle", YN), {
        by: "moralCharacter.hereditaryOrInheritedTitles.titleOfNobility.question", is: "true",
      }),
    ],
  },
  {
    slug: "/moral-character/tax-information",
    title: "Tax information",
    kind: "form",
    fields: [
      ...q("moralCharacter.taxInformation.oweTaxes"),
      ...q("moralCharacter.taxInformation.calledNonResidentOnTaxReturn"),
    ],
  },
  {
    slug: "/moral-character/party-or-group-affiliations",
    title: "Party or group affiliations",
    kind: "form",
    fields: [
      ...q("moralCharacter.partyOrGroupAffiliations.communistGroup"),
      ...q("moralCharacter.partyOrGroupAffiliations.advocatedOverthrow"),
    ],
  },
  {
    slug: "/moral-character/party-or-group-affiliations/party-or-group-affiliations-page-2",
    title: "Party or group affiliations page 2",
    kind: "form",
    fields: [
      ...q("moralCharacter.partyOrGroupAffiliationsPage2.usedWeaponAgainstPerson"),
      ...q("moralCharacter.partyOrGroupAffiliationsPage2.engagedInKidnapping"),
      ...q("moralCharacter.partyOrGroupAffiliationsPage2.helpGroupThreatenToUseWeapon"),
    ],
  },
  {
    // Torture and genocide are SEPARATE radios here, so unlike the I-539 no
    // `any_true` OR-entry is needed — they map onto the two facts we hold.
    slug: "/moral-character/good-moral-character",
    title: "Good moral character",
    kind: "form",
    fields: [
      ...q("moralCharacter.goodMoralCharacter.involvedInTorture"),
      ...q("moralCharacter.goodMoralCharacter.involvedInGenocide"),
      ...q("moralCharacter.goodMoralCharacter.involvedInKilling"),
      ...q("moralCharacter.goodMoralCharacter.involvedInIntentionallyHarming"),
    ],
  },
  {
    slug: "/moral-character/good-moral-character/good-moral-character-page-2",
    title: "Good moral character page 2",
    kind: "form",
    fields: [
      // "invovledInForcingSexRelations" is MISSPELLED by USCIS (invovled).
      // Reproduce it exactly — a corrected spelling matches nothing.
      ...q("moralCharacter.goodMoralCharacterPage2.invovledInForcingSexRelations"),
      ...q("moralCharacter.goodMoralCharacterPage2.involvedInStoppingPracticeOfReligion"),
      ...q("moralCharacter.goodMoralCharacterPage2.persecuted"),
    ],
  },
  {
    slug: "/moral-character/paramilitary-police-and-prison-service",
    title: "Paramilitary, police, and prison service",
    kind: "form",
    fields: [
      ...q("moralCharacter.paramilitaryPoliceAndPrisonService.partOfPoliceUnit"),
      ...q("moralCharacter.paramilitaryPoliceAndPrisonService.partOfSelfDefenseUnit"),
      ...q("moralCharacter.paramilitaryPoliceAndPrisonService.workedAtDetentionFacility"),
    ],
  },
  {
    slug: "/moral-character/weapon-use-and-training",
    title: "Weapon use and training",
    kind: "form",
    fields: [
      ...q("moralCharacter.weaponUseAndTraining.threatenedToUseWeaponAgainstPerson"),
      ...q("moralCharacter.weaponUseAndTraining.everSoldWeapon"),
      ...q("moralCharacter.weaponUseAndTraining.receivedMilitaryOrWeaponTraining"),
    ],
  },
  {
    slug: "/moral-character/recruitment-information",
    title: "Recruitment information",
    kind: "form",
    fields: [
      ...q("moralCharacter.recruitmentInformation.everHelpedArmedGroup"),
      ...q("moralCharacter.recruitmentInformation.forcedChildToSupportArmedCombat"),
    ],
  },
  {
    // NO `.question` suffix on either field, so neither has an explain sibling.
    // Answering Yes instead reveals two whole PAGES below, plus seven crime
    // evidence pages.
    slug: "/moral-character/crimes-and-offenses",
    title: "Crimes and offenses",
    kind: "form",
    fields: [
      radio("moralCharacter.crimesAndOffenses.committedCrime", YN),
      radio("moralCharacter.crimesAndOffenses.arrested", YN),
    ],
  },
  {
    // PDF Part 9 Item 15. Revealed only after COMMITTING a Yes above — answering
    // without committing shows nothing, which is why this looked absent at first.
    slug: "/moral-character/crimes-and-offenses/crimes-and-offenses-page-2",
    title: "Crimes and offenses page 2",
    kind: "form",
    conditional: true,
    fields: [
      t("moralCharacter.crimesAndOffensesPage2.{i}.crimeOrOffense"),
      t("moralCharacter.crimesAndOffensesPage2.{i}.dateOfCrimeOrOffense"),
      t("moralCharacter.crimesAndOffensesPage2.{i}.dateOfConvictionOrGuiltyPlea"),
      search("moralCharacter.crimesAndOffensesPage2.{i}.placeOfCrimeOrOffense.country"),
      t("moralCharacter.crimesAndOffensesPage2.{i}.placeOfCrimeOrOffense.city"),
      search("moralCharacter.crimesAndOffensesPage2.{i}.placeOfCrimeOrOffense.state"),
      t("moralCharacter.crimesAndOffensesPage2.{i}.resultOfArrest"),
      t("moralCharacter.crimesAndOffensesPage2.{i}.whatWasYourSentence"),
    ],
    repeater: {
      namePrefix: "moralCharacter.crimesAndOffensesPage2",
      // A BARE "Add" — and it is a substring of "Add an address", "Add a child"
      // and the rest, so this one must be matched exactly, never by substring.
      addButtonText: "add",
      rowCommitButtonText: "Save",
    },
  },
  {
    slug: "/moral-character/crimes-and-offenses/crimes-and-offenses-page-3",
    title: "Crimes and offenses page 3",
    kind: "form",
    conditional: true,
    fields: [radio("moralCharacter.crimesAndOffensesPage3.suspendedSentence", YN)],
  },
  {
    slug: "/moral-character/illegal-activity",
    title: "Illegal activity",
    kind: "form",
    fields: [
      // "engagePrositution" and "marriedToObtainImmigrantBenfits" are both
      // MISSPELLED by USCIS. Reproduce exactly.
      ...q("moralCharacter.illegalActivity.engagePrositution"),
      ...q("moralCharacter.illegalActivity.soldOrSmuggledDrugs"),
      ...q("moralCharacter.illegalActivity.marriedMoreThanOnce"),
      ...q("moralCharacter.illegalActivity.marriedToObtainImmigrantBenfits"),
      ...q("moralCharacter.illegalActivity.helpedIllegallyEnter"),
    ],
  },
  {
    slug: "/moral-character/illegal-activity/illegal-activity-page-2",
    title: "Illegal activity page 2",
    kind: "form",
    fields: [
      ...q("moralCharacter.illegalActivityPage2.gambledIllegally"),
      ...q("moralCharacter.illegalActivityPage2.failedToPayAlimony"),
      ...q("moralCharacter.illegalActivityPage2.misrepresentationToAcquireBenefit"),
      ...q("moralCharacter.illegalActivityPage2.givenFalseInfoWhileApplying"),
      ...q("moralCharacter.illegalActivityPage2.liedToGainAdmission"),
    ],
  },
  {
    slug: "/moral-character/immigration-proceedings",
    title: "Immigration proceedings",
    kind: "form",
    fields: [
      ...q("moralCharacter.immigrationProceedings.placedInRemoval"),
      ...q("moralCharacter.immigrationProceedings.everDeported"),
    ],
  },
  {
    slug: "/moral-character/selective-service",
    title: "Selective service",
    kind: "form",
    fields: [radio("moralCharacter.selectiveService.maleBetween18and26", YN)],
  },
  {
    slug: "/moral-character/military-service",
    title: "Military service",
    kind: "form",
    fields: [
      ...q("moralCharacter.militaryService.avoidedDraft"),
      ...q("moralCharacter.militaryService.appliedForMilitaryExemption"),
      // No `.question` suffix on these two, so no explain siblings.
      radio("moralCharacter.militaryService.servedUSArmedForces", YN),
      radio("moralCharacter.militaryService.currentlyMemberOfUSArmedForces", YN),
    ],
  },
  {
    slug: "/moral-character/attachment-to-the-us-constitution",
    title: "Attachment to the U.S. constitution",
    kind: "form",
    fields: [radio("moralCharacter.attachmentToTheUsConstitution.supportTheConstitutionOfUS", YN)],
  },
  {
    slug: "/moral-character/oath-of-allegiance",
    title: "Oath of allegiance",
    kind: "form",
    fields: [
      radio("moralCharacter.oathOfAllegiance.understandOath", YN),
      // `unableToTakeOath` = Yes is a substantive N-648-adjacent answer. It must
      // only ever come from an explicit firm answer, never from a default.
      radio("moralCharacter.oathOfAllegiance.unableToTakeOath", YN),
    ],
  },

  // ── Evidence (upload-only) ──────────────────────────────────────────────
  // Every one of these carries a single input[type=file] with id="desktop-drop",
  // NO name attribute, multiple=true, and accept =
  // image/jpg,image/jpeg,application/pdf,image/tif,image/tiff — note NO PNG.
  // Which pages appear depends on eligibility basis, marital status and the
  // crimes answers, so most are conditional. Slugs are verbatim: matching is a
  // case-sensitive path compare.
  { slug: "/evidence/your-permanent-resident-card", title: "Your Permanent Resident Card", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/your-current-spouse-us-citizenship", title: "Your current spouse's U.S. citizenship", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/current-marriage-certificate-and-previous-marriage-documents", title: "Current marriage certificate and previous marriage documents", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/evidence-about-your-marriage", title: "Evidence about your marriage", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/current-spouse-qualifying-employment", title: "Current spouse qualifying employment", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/child-and-spousal-support", title: "Child and spousal support", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/official-military-orders", title: "Official military orders", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/separation-from-us-armed-forces", title: "Separation from U.S. armed forces", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/form-n426-request-for-certification-of-military-or-naval-service", title: "Form N-426", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/arrests-without-charges", title: "Arrests without charges", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/arrests-with-charges", title: "Arrests with charges", kind: "upload", fields: [], conditional: true },
  // CAPITAL A, unlike every neighbouring slug. Verified live: the page loads
  // ONLY with the capital. Lower-casing it would look wired and upload nothing —
  // exactly what happened to the I-539's /evidence/form-I-20.
  { slug: "/evidence/Alternative-sentencing-or-rehabilitative-programs", title: "Alternative sentencing or rehabilitative programs", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/convictions-and-sentences", title: "Convictions And Sentences", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/arrests-or-convictions-removed-from-your-records", title: "Arrests or convictions removed from your records", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/traffic-incidents", title: "Traffic incidents", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/fine-restitutions-and-wage-garnishments", title: "Fine, restitutions, and wage garnishments", kind: "upload", fields: [], conditional: true },
  { slug: "/evidence/additional-evidence", title: "Additional evidence you want to provide", kind: "upload", fields: [] },

  // ── Additional information ──────────────────────────────────────────────
  {
    // additionalInformationTable — NOT the I-539's additionalInformationArray.
    // Same "Add a response" label, different prefix.
    slug: "/additional-information/additional-information",
    title: "Additional information",
    kind: "form",
    fields: [
      t("additionalInformationTable.{i}.section"),
      t("additionalInformationTable.{i}.page"),
      t("additionalInformationTable.{i}.question"),
      area("additionalInformationTable.{i}.response"),
    ],
    repeater: {
      namePrefix: "additionalInformationTable",
      addButtonText: "add a response",
      rowCommitButtonText: "Save response",
    },
  },

  // ── Review (TERMINAL) ───────────────────────────────────────────────────
  {
    // Renders no inputs. Its advance control is a plain "Next"
    // (id=button-button, data-testid=next-button), byte-identical to every other
    // page's, and it is disabled ONLY while the application is incomplete — which
    // means a successful autofill is exactly what enables it. The stop is this
    // `kind: "review"` entry plus onTerminalPath() matching /review-and-submit/*
    // by PATH. No text rule can protect this page. MUST be last: fillAll breaks
    // on kind === "review", so anything after it is unreachable.
    slug: "/review-and-submit/review-your-application",
    title: "Review your application",
    kind: "review",
    fields: [],
  },
];
