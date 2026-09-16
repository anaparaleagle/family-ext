# Online I-485 capture — report (2026-09-15)

Draft `5ab9035c-215b-3079-b383-dc2016afccad` (user supplied the draft and granted
claude-in-chrome permission; Claude drove the capture live). Host base:

    https://my.uscis.gov/pdf-intake/I-485/<draftId>/<slug>

Files: `01`–`20`, one per page, walked in order. Plus
`branch-able-to-pay-no.json` (fee-waiver reveal),
`branch-employment-based-select-eligibility.json` and
`branch-derivative-applicant-select-eligibility.json` (the two page-01 swaps),
and `eligibility-options.json` (all three cascading option lists with value codes).

Same `pdf-intake` product as the I-765 — same `next-btn`/`back-btn` testids, same
"upload the finished PDF" premise — but the page set is nearly twice as long and
page 01 and page 03 are much richer. Read this next to
`../i765-online-field-dump/NOTES.md`; the deltas are the point.

## THE HEADLINE — same PDF-intake wrapper, but gated on a real client record

- 3 typed pages (select-eligibility, able-to-pay, client-information/0), 16 upload
  pages (I-485 PDF, G-28 PDF, 14 evidence slots), then review. 20 pages total.
- **No "PDF Intake BETA Preview!" banner anywhere on the I-485** — the I-765 carried
  it on every page. Don't use it as a detection signal for this flow.
- Page order differs from the I-765: **able-to-pay is page 2, before
  client-information** (on the I-765 it was page 3, after it).
- **`/client-information/0` cannot be passed with Next.** It ends in an **"Add
  Client" button**, and `next-btn` stays disabled until the client is actually
  added to the attorney's USCIS client list. That is a real, persistent,
  account-level write (and the page warns the client's email must not already
  belong to a USCIS account), so **it was not clicked** — page 03 is captured in
  its empty arrival state. Everything downstream was reached by typing the URL
  directly, which the app allows.

## Page 01 `/select-eligibility` — THREE cascading controls, not one dropdown

The I-765 had one flat list of (a)/(c) category codes. The I-485 asks who → which
track → which relationship, each control revealed by the one above:

1. `eligibility-choice` (autocomplete) — "Select one" / Principal Applicant /
   Derivative Applicant. Values `PrincipalApplicant`, `DerivativeApplicant`.
2. `eligibility-category-choice` (autocomplete) — Family-based / Employment-based.
   Values `FAMILY_BASED`, `EMPLOYMENT_BASED`. No placeholder row.
3. `<choice>-subcategories` (radio list) — **the group name is built from control 1**:
   `PrincipalApplicant-subcategories` or `DerivativeApplicant-subcategories`.
   15 family options / 8 employment options; both principal and derivative carry
   byte-identical option sets. All value codes are in `eligibility-options.json`.

Plus a fourth control present from the moment control 1 is set: the Six-and-Six
radio (`controlled-radio-buttons-group`, INA 101(a)(27)(K)), **pre-checked "No"** —
the only control in the whole walk with a non-empty default.

`next-btn` is disabled until a subcategory radio is picked. Changing control 1 or 2
**clears** the subcategory and re-disables Next, in-page, with no navigation.

Captured state: Principal Applicant + Family-based + `USC_SPOUSE` (the IR-1 case).
The 15 family codes cover IR-1/IR-2/IR-5 (`USC_SPOUSE`, `USC_MINOR_CHILD`,
`USC_PARENT`), the F preference ladder, K-1/K-2, widow(er), NDAA and VAWA.

## Page 03 `/client-information/0` — real Formik-style fields, and the Add Client gate

Seven fields, versus three on the I-765: `firstName` / `middleName` / `lastName`
(real ids, `label[for]` wired), plus `aNumber` with an `aNumberCheckbox` ("The
Client does not know or have their A-Number"), `dateOfBirth` (type=**text**, an MUI
date field, MM/DD/YYYY), and `emailAddress` (type=email, placeholder
`johnsmith@example.com`).

**Trap:** `aNumber`, `dateOfBirth` and `emailAddress` have **no `<label for>`** —
they are wired by `aria-labelledby` (`clientANumber`, `clientDateOfBirth`,
`clientEmailAddress`). Resolve that attribute or anchor on the heading text;
a label-only field matcher finds nothing for three of the seven fields.

The slug is indexed (`/0`) and the page has an "Add Client" button, so this flow
is multi-client — but the multi-client behaviour was **not** exercised.

## The 14 evidence pages — a FIXED list

Slug shape is `/<doc-slug>/I-485/evidence` (the I-765 used `/I-765/evidence`), in
walk order: `485-2-by-2-photograph`,
`government-issued-identity-document-with-photograph`, `birth-certificate`,
`evidence-of-inspection-and-admission-parole`,
`485-i-797-documentation-of-immigrant-category`, `lawful-status-since-arrival-in-us`,
`i-693-medical-vaccination-record`, `affidavit-of-support`,
`certified-police-and-court-records`, `i-508-form-upload`, `i-566-form-upload`,
`i-612-form-upload`, `principal-applicant-form-i-485-or-green-card`,
`additional-evidence`.

**The list does not vary.** Unlike the I-765 (where the evidence slots swapped
C9 ⇄ A12 with the category), all 14 appear for every combination tried — including
the `(if applicable)` ones (I-508/I-566/I-612) and the derivative-only
`principal-applicant-form-i-485-or-green-card`, which is present even when
Principal Applicant is selected. So the descriptor can hard-code these 14.

Accept lists are **not** uniform — three shapes:
- `image/jpeg,.jpeg,.jpg,.png` — photo page only.
- `application/pdf,.pdf` — I-693, I-864 affidavit, police/court records.
- `...jpeg,.jpg,.tif,.tiff,.png,...pdf` — the rest, except
  `principal-applicant-form-i-485-or-green-card`, which **omits png**.
All are `multiple: true`. Limits: max 5 documents at a time, 12MB per file,
translations + translator certification required for foreign-language documents.

## Traps specific to this flow

- **Evidence Next needs TWO clicks.** On an empty evidence page the first Next
  click does not navigate — it injects a "Missing Evidence" warning box above the
  buttons ("It does not appear that you have uploaded any evidence… may delay
  processing"). The second click advances. A one-shot "click Next" driver will
  silently stall on all 14 pages.
- **`controlled-radio-buttons-group` is reused** for the Six-and-Six question
  (page 01) and "Are you able to pay the filing fee?" (page 02) — different
  questions, same generic MUI name, exactly as on the I-765. Anchor radios by the
  `question` text captured in each dump, never by name.
- **Programmatic `.click()` does not work** on these controls — `el.click()` on
  `[data-testid=next-btn]`, and on autocomplete options, is ignored; only real
  (trusted) mouse events drive them. The extension's driver must dispatch real
  input events, not element clicks, on this host.
- The two autocompletes must be driven as "search" controls (click to open, pick
  from `[role=option]`), like the I-765 eligibility control.
- Page titles are distinct and stable ("USCIS | Eligibility Category",
  "USCIS | Fee Waiver", "USCIS | Add Client Information", "USCIS | Upload PDF (I-485)",
  "USCIS | Upload PDF (G-28)", "USCIS | Evidence - <label>", "USCIS | Review Your
  Submission") — good secondary detection signals.
- Upload control text is the generic "Choose or drop file here to upload"
  everywhere **except** the fee-waiver reveal, which is item-specific:
  "Choose or drop file here to upload a I-912 form".
- Selections persist immediately, without Next — page 01 still held
  Principal/Family/USC_SPOUSE after a full reload.

## Page 20 `/review`

Same terminal-guard trap as the I-765 and the N-400: **`next-btn` is DISABLED**
while items are missing, so a successful run ENABLES it. Mark the page
`kind:"review"` and make the terminal guard cover `/review` on this host path.

Only **two** alerts are raised ("Your Form I-485 is missing", "Your Form G-28 is
missing"), each with an "Edit my responses" button. **The 14 evidence slots raise
no review alert at all** — they only warn in-page at Next time. So review-page
alerts are not a sufficient completeness check for this form.

The fee line read **"Your form filing fee is: $0.00"** on this incomplete draft.
Treat that as unverified rather than as the real I-485 fee; it most likely
resolves once client information is completed. Not worth trusting either way.

## What the extension/backend build needs from this

- Registry: hostPath `/pdf-intake/I-485/`, caseTypes IR-1/IR-2/IR-5 (and the F
  preference categories) via the `FAMILY_BASED` codes.
- Descriptor: 3 typed pages + 16 upload pages + review, slugs above; evidence
  slugs carry the `/I-485/evidence` suffix; evidence pages need the double-Next.
- Backend map (form_myuscis_definitions.json): eligibility-choice (Principal for
  the principal beneficiary, Derivative for a following-to-join spouse/child),
  eligibility-category-choice (const FAMILY_BASED), subcategory code derived from
  the relationship on the underlying I-130, Six-and-Six (const No unless a fact
  says otherwise), able-to-pay, and client first/middle/last + A-number (or the
  "does not know" checkbox) + DOB + email. Upload pages: generated_form I-485 →
  `/form`, generated_form G-28 → `/form-g28`, then doc_type-mapped evidence across
  the 14 fixed slots.
- Left OPEN (not captured): the **Add Client** flow and everything it gates
  (whether the walk changes once a client exists, multi-client
  `/client-information/{i}`), and the post-review sign/pay/submit pages. Nothing
  was submitted, paid for, or signed; no file was uploaded; no client was added.

Draft left exactly as found apart from page 01, which now holds Principal
Applicant / Family-based / Spouse of a U.S. Citizen, and page 02, which holds
"Yes" (able to pay). The client-information page was re-checked at the end and is
empty — the test values typed there were never saved.
