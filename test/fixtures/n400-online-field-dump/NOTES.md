# Online N-400 capture — report (2026-07-30)

Draft `13370795` (Ana created it), captured live. Host base:

    https://my.uscis.gov/forms/application-for-naturalization/<draftId>/<slug>

The draft was **blank**, so this is the **unconditional** shape of the form.
No conditional reveal is captured — that needs permission to type throwaway
answers, which was not given this session.

Raw dump: **`n400-online-field-dump.json`** (34 pages, 112 fields, sidebar order).
Reveals + repeater row shapes: **`n400-online-reveals.json`** (second pass, Ana
authorised typing throwaway answers).
Reusable capture snippet: **`n400-page-dump.js`**.

## Read the reveals file for the two biggest wins

1. **Every `<x>.question` radio has a sibling `<x>.additionalExplanation`
   textarea** revealed by answering Yes, and a field WITHOUT the `.question`
   suffix has no explain sibling. Proven on four fields with a negative control.
   That covers ~35 moral-character explains **mechanically** — derive them, don't
   capture them one by one. It is also where SOF-1066's 28 orphaned Good Moral
   Character explains go online (NOT a Part 14 continuation sheet, which is
   paper-only).
2. **The `/evidence/*` page set is CONDITIONAL on the answers**, like the I-539's
   is on target status. Five slugs known so far; two appear only for
   eligibility=spouse and one only for married. So the backend `upload_pages`
   needs a conditional filter keyed on `applicant.eligibility_basis` — and the
   condition that reveals the spouse pages is *exactly* the `when` clause already
   sitting in `document_requirements.json`.

## Also new from the reveal pass

- **A two-level repeater exists** — trip rows each contain a `countries.{j}` list
  with its own "Add country" button. `RepeaterSpec` carries a single namePrefix +
  addButtonText, so the descriptor type needs extending before travel can be
  driven. First nested repeater in the extension.
- **Row commit buttons differ per repeater**: "Save entry", "Save child". The
  I-539 already got bitten once by matching advance controls on literal text.
- **schools-and-employment is POLYMORPHIC** — one repeater, four row shapes
  (self-employment / unemployment / school / employer) chosen by an Autocomplete.
  Only the employer shape is captured.
- **Option code style is inconsistent across the form.** Numeric on eligibility,
  marital status and gender; full display text on the children rows
  (`"Resides with me"`, `"Biological son or daughter"`) — and even there code and
  label can differ (`Unknown` is labelled `Unknown/Missing`). Never assume a style.
- **Uncommitted answers REVERT on navigation.** myUSCIS persists only on Next, so
  anything read after setting a value but before committing is transient. This is
  why the definitive evidence-page set per scenario is still open.
- **SOF-1066 Item 12.c found**:
  `applicant.yourImmigrationInformationPage2.consentForDisclosure`, revealed by
  `wantSocialSecurityCard = true`.
- **The crime table is NOT in-page.** Answering both
  `crimesAndOffenses.committedCrime` and `.arrested` Yes revealed nothing, so the
  Part 9 Item 15 table lives on a page that only appears after a Next-commit.
  Still unknown.

## Coverage

- **37** page slugs in the sidebar — complete list captured.
- **34** pages reached and dumped.
- **112** unconditional typed fields.
- **3** pages NOT reached, all because they bounce on a URL deep-link:
  `/moral-character/oath-of-allegiance`,
  `/evidence/current-marriage-certificate-and-previous-marriage-documents`,
  `/evidence/additional-evidence`. They need the Next-button walk, which needs
  answers typed to satisfy required fields first.

## The headline: this form is CHEAPER to add than the I-539 was, except for the codes

Confirmed live, not assumed:

- **Same React/Formik/MUI platform.** The engine, Formik bridge and value-setter
  drive it unchanged.
- **No applicant/beneficiary inversion.** Single applicant. That trap is I-130-only.
- **The preparer page is IDENTICAL to the I-539's, all 9 fields.** Same names,
  same `noBusiness` / `noMobilePhone` / `noEmailAddress` checkbox trio. The I-539
  backend map entries transfer verbatim, including the SOF-1004 mobile pair.
- **The preparer/interpreter reveal gate is identical too**
  (`...hasHelper` → `.helper.hasPreparer` / `.helper.hasInterpreter`).
- **The additional-information repeater Add label is "Add a response"** — also
  identical to the I-539's.
- **The review page shares the `/review-and-submit/` parent path**, so the
  `onTerminalPath()` guard already in `fill-chain.ts` covers the N-400 for free.
- **Gating `.none` checkboxes exist here too** (`datePermResident.none`,
  `socialSecurityNumber...none`, `uscisAccountNumber.none`). These are the same
  shape that STALLED the I-539 Fill-all when they were left in the skip list.
  Drive them from day one.
- **Torture and genocide are SEPARATE radios**, so unlike the I-539 no `any_true`
  OR-entry is needed — they map straight onto the two facts we hold.

## FOUR top-level namespaces, not one

The I-539 is almost entirely `applicant.*`. The N-400 is not:

| namespace | covers |
|---|---|
| `gettingStarted.*` | basis of eligibility, preparer/interpreter |
| `applicant.*` | About You — name, contact, birth, immigration info, describe yourself |
| `yourFamily.*` | marital status, children |
| `moralCharacter.*` | all 18 moral-character pages |
| `formikFactoryUIMeta.*` | UI-only toggles and the gating `.none` checkboxes |

A map author who assumes `applicant.*` misses two thirds of the form.

## TRAP 1 — opaque, NON-SEQUENTIAL option codes (highest risk)

The I-130/I-539 used `true`/`false` or word codes. The N-400 uses bare numeric
ids that do **not** follow display order. Getting one wrong files a materially
different application, silently.

**Basis of eligibility** — `gettingStarted.changeBasisForEligibility.eligibilityCode`:

| code | label | our `applicant.eligibility_basis` |
|---|---|---|
| 191 | General provision | `general_5yr` |
| 192 | Spouse of a U.S. citizen | `spouse_3yr` |
| 189 | Spouse/former spouse/child of a USC under VAWA | not modelled |
| 193 | Spouse of USC in qualified employment outside the US | not modelled |
| 194 | Military service during a period of hostilities | not modelled |
| 190 | At least one year of honorable military service at any time | not modelled |
| 195 | Other | `other` |

**Marital status** — `yourFamily.maritalStatus.status`:

| code | label |
|---|---|
| 1 | Single, never married |
| 2 | Married |
| 3 | Divorced |
| 4 | Widowed |
| **7** | **Separated** |
| **5** | **Marriage annulled** |

Separated is **7**, not 5. Positional guessing would file "Marriage annulled"
for a separated applicant.

**Gender** — `applicant.describeYourself.gender`: **3 = Male, 1 = Female.** The
same non-obvious pair already confirmed live on the I-130 (2026-06-26), so this
is consistent across myUSCIS forms rather than a one-off.

Rule: pair every multi-option control to its own label before mapping it. Never
read meaning off option order.

## TRAP 2 — some fields have NO Formik name at all

Two cases found, and both defeat a purely name-based descriptor:

1. **A random UUID.** The current physical address's *To* date is
   `name="8742c00f-044a-46a1-ab32-60d2a2611150"`, label `"To (MM/DD/YYYY) Present"`.
   A UUID cannot be hardcoded — it will differ. This field must be matched by
   **label** (or by position relative to `...datesOfResidence.fromDate`).
2. **Bare numeric names.** The five race checkboxes on `describe-yourself` are
   `name="1"`, `"2"`, `"3"`, `"5"`, `"6"` with no path. Their individual labels
   still need pairing (the capture could not resolve them — all five share one
   form-control wrapper).

This makes the **label/aria fallback matcher** — currently a "future hardening"
backlog note in the agent file — a **requirement** for the N-400, not an optional
robustness nicety. At least one required-ish field is unreachable without it.

## TRAP 3 — `isMailingSameAsPhysical` is a CHECKBOX

`applicant.yourContactInformation.mailingAddress.isMailingSameAsPhysical` is
`type=checkbox`.

This is exactly the bug already found and fixed live on **both** the I-130 and
I-539: a checkbox-shaped control can only ever emit `"true"` or blank, never
`"false"`. Map it with the `{checkbox, equals, on}` entry shape from the start
rather than rediscovering it.

Note also this page carries **both** a `physicalAddress.*` block and a
`mailingAddress.address.*` block — the exact pair SOF-1066 is untangling on the
PDF side, where `applicant.mailing_*` is currently wired to the physical block.

## TRAP 4 — USCIS misspells its own field names

Reproduce these byte for byte; a corrected spelling matches nothing:

- `moralCharacter.goodMoralCharacterPage2.invovledInForcingSexRelations` (**invovled**)
- `moralCharacter.illegalActivity.engagePrositution` (**Prositution**)
- `moralCharacter.illegalActivity.marriedToObtainImmigrantBenfits` (**Benfits**)

## TRAP 5 — the render poll must settle on input COUNT, not the page title

`document.title` gains the page name **before** React renders the form body. A
title-only poll returns an empty page and records **0 fields** for a page that
has plenty. It did exactly that to `/your-family/marital-status`, which really
holds a 6-option radio.

Correct wait: title match, **then** poll until the `input,select,textarea` count
is stable across 3 consecutive 250ms reads (min ~1.8s). A genuinely empty page
settles at 0 quickly, so it stays fast for repeater and review pages.

Cost of getting this wrong is silent under-capture, which then reads as a
complete dump. This is the same failure family as the I-539's "0/N filled".

## TRAP 6 — deep-link bounces are SILENT

Navigating to `/moral-character/oath-of-allegiance` reports a **successful**
navigation, then the SPA redirects back to
`/moral-character/attachment-to-the-us-constitution`. Only `location.pathname`
reveals it.

This recorded the redirect target three times under three different page names
before I caught it. Any dumper or walker MUST assert the landed pathname equals
the expected slug and refuse to store on mismatch.

## TRAP 7 — the session expires mid-walk

After roughly 30 minutes `my.uscis.gov` began redirecting to
`myaccount.uscis.gov/sign-in`. Two notes:

- I cannot sign back in (entering credentials is off-limits), so a long capture
  needs Ana available.
- `sessionStorage` **survives** this — it is per-origin and came back intact once
  signed in and back on `my.uscis.gov`. My first check reported it lost because I
  ran the check *from the sign-in origin*. Don't panic-rewalk; re-check from the
  right origin first.

## SAFETY — the review page cannot be stopped by button text

`/review-and-submit/review-your-application` renders **no inputs** and its
advance control is a plain **"Next"**, `id=button-button`,
`data-testid=next-button` — byte-identical to every other page's. A
`NEVER_CLICK_TEXT` regex therefore cannot stop it.

It is `disabled` only while the application is incomplete, which means **a
successful autofill is exactly what enables it.**

The real stop is the descriptor's `kind:"review"` entry plus `onTerminalPath()`
in `fill-chain.ts`. Because the N-400's review slug sits under the same
`/review-and-submit/` parent as the I-539's, **that guard already covers the
N-400 with no change.** Verify it, don't assume it.

## Repeaters — five, with their real Add labels

Captured from the live buttons, so these are not guesses:

| page | Add label | feeds |
|---|---|---|
| `/about-you/where-you-have-lived` | `Add an address` | PDF Part 5 residence history |
| `/about-you/schools-and-employment` | `Add entry` | PDF Part 7 employment/education |
| `/about-you/travel-outside-the-us` | (gate radio first) | PDF Part 9 travel history |
| `/your-family/children` | `Add a child` | PDF Part 6 children |
| `/additional-information/additional-information` | `Add a response` | PDF Part 14 |

None render any inputs until Add is clicked, so **indexed row field names are
still unknown** for all five. Capturing them needs one Add click per repeater.

Note `/about-you/travel-outside-the-us` shows only the gate
(`formikFactoryUIMeta.applicant.travelOutsideTheUs.travelLast5Years`) with no Add
button until it is answered Yes.

## What this says about the backend map and SOF-1066

- **Only TWO evidence pages exist online**: the marriage-certificate slot and
  Additional evidence. N-400 `document_requirements` lists far more — green_card,
  3-or-5-year tax_transcript, passport, passport_previous, drivers_license,
  child_birth_certificate, name_change_document, selective_service_record,
  arrest_record, police_report, court_disposition, translation, plus the whole
  spouse_citizenship and spouse_bona_fide groups. So nearly everything must route
  to `/evidence/additional-evidence` as a **server-side `catch_all`**, exactly
  like the I-539's. Keep the expansion server-side: that is what enforces
  `never_upload_to_uscis` on the SSN card, and SOF-1066 is *adding* `ssn_card` to
  the N-400 checklist.
- **No fee-reduction page online.** PDF Part 10, which SOF-1066 puts out of
  scope, has no online counterpart — nothing to skip, nothing to allowlist.
- **SOF-1066 items with a confirmed online counterpart:**
  `datePermResident.date` (= `applicant.date_became_lpr`, from green-card OCR);
  `wantSocialSecurityCard` (= Part 2 Item 12.a); `physicalAddress.inCareOfName`
  and the residence date fields (Part 4/5 detail); `hasNameChanged`
  (name_change_document); the children question, whose online label already reads
  "ALL children under 18 years of age" and so corroborates the "of any age" →
  "under 18" change.
- **SOF-1066 items whose online control is a conditional reveal, still uncaptured:**
  Part 2 Item 12.c SSA consent, the Part 9 Item 15 crime table, the nobility-titles
  text on 30.a, and the Part 9 singles. All sit behind a `.question` radio — note
  the `.question` suffix on nearly every moral-character field strongly implies a
  sibling explain field revealed on Yes, which is where the 28 orphaned Good Moral
  Character explains would land.
- **Part 14 / continuation-sheet `overflow` does not transfer.** Online has the
  `additional-information` repeater instead.

## Open decision for Ana

SOF-1066 keeps the 12 `case.n400_preparer_*` questions and allowlists them out of
the PDF map, on the grounds that firm settings can differ from the actual
preparer. But the **online** form has a full preparer page, and the I-539 fills
that from `firm.*`. So the online N-400 has to pick a source: `firm.*` like the
I-539, or the `case.n400_preparer_*` answers. Worth settling once.

## Next session, in order

1. Get permission to type throwaway answers into the draft.
2. Pair the 5 race checkbox codes to their labels, and dump the option lists for
   the four Autocompletes (`height.feet`, `height.inches`, `eyeColor`,
   `hairColor`) plus country/state — byte for byte, per the I-539 picker lesson.
3. Click Add once on each of the 5 repeaters and capture indexed row names.
4. Answer the gates to reveal and capture: the spouse block, prior marriages, the
   crime table, travel rows, the Part 9 explain fields, Item 12.c, and the
   interpreter page.
5. Walk with Next to reach the 3 bouncing pages and confirm the two evidence
   slugs and their upload controls.
6. Vendor the finished dump to
   `paraleagle-family-ext/test/fixtures/n400-online-field-dump/` so CI can read
   it, per the I-539 precedent.
7. Build `test/n400-coverage.test.ts` **before** writing map or descriptor
   entries — the I-539 guard caught four shipped bugs on its first run.
8. Delete draft `13370795`, plus the two known stragglers: I-130 draft `13008576`
   and I-539 draft `13347412`.
