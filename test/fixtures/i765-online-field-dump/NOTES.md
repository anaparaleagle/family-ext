# Online I-765 capture — report (2026-09-11)

Draft `d26a43cc-0f10-301e-86d3-a5ef2a773b85` (user created it; user granted claude-in-chrome
permission and Claude drove the capture live). Host base:

    https://my.uscis.gov/pdf-intake/I-765/<draftId>/<slug>

Files: `01`–`12` one per page (C9 walk), `branch-a12-select-eligibility.json`
(the A12/TPS page set, proving evidence slots swap per category),
`eligibility-options.json` (full dropdown list).

## THE HEADLINE — this is NOT a guided form. It is USCIS "PDF Intake" (BETA)

Unlike the I-130/I-539/N-400 (guided Formik forms, field-by-field), the online
I-765 is a wrapper around a **PDF upload**:

- 3 typed pages: select-eligibility (3 fields), client-information/0 (3 name
  fields), able-to-pay (1 radio + conditional I-912 upload).
- Everything else is upload slots: the completed I-765 PDF, the G-28 PDF, and
  6 evidence pages.
- The extension therefore mostly needs the **doc-upload flow** here, not field
  filling. The backend's already-generated filled+signed I-765 PDF is exactly
  what `/form` wants ("Upload one PDF file of the form", all pages, in order).
  Same for the generated G-28 at `/form-g28` (signature must be handwritten per
  on-page text — use the signed G-28, not the unsigned draft).

## Eligibility categories: pdf-intake supports SEVEN, and no OPT/H4

Dropdown (byte-exact in eligibility-options.json): (a)(12), (c)(8), **(c)(9)**,
(c)(11) Parole, (c)(11) Ukraine Parolee, (c)(19). The on-page banner says any
other category must use the guided "Fill Out Form Fields Online" or paper.
**So this flow serves the family C9 (pending-I-485) case — IR-1/IR-2/IR-5 —
and cannot serve I-765-OPT (c)(3)(B) or I-765-H4 (c)(26).** Input `value`
codes observed: `C9`, `A12` (letter+digits, no parens).

## The C9 page set (12 pages)

1. `/select-eligibility` — eligibility autocomplete (`eligibility-choice`),
   reason radio (`reason-for-filing-radio-group`: Initial/Replacement/Renewal),
   C9-only Yes/No gate (`controlled-radio-buttons-group`): "You filed your
   I-485 with a fee on or after 04/01/2024 and your form is still pending."
   (Yes ⇒ fee-exempt, review page shows $0.00.)
2. `/client-information/0` — firstName / middleName / lastName (the CLIENT's
   name; this is the legal-rep flavor). Indexed slug ⇒ possibly multi-client.
3. `/able-to-pay` — "Are you able to pay the filing fee?" Yes/No; **No reveals
   the Form I-912 fee-waiver upload inline on this page** (sidebar gains
   "Upload Form I-912").
4. `/form` — upload completed I-765 PDF (pdf only, one file, all pages).
5. `/form-g28` — upload completed G-28 PDF (pdf only).
6.–11. evidence uploads (`<slug>/I-765/evidence`): applicant-photo (jpeg/png),
   form-i-94-passport, employment (= prior EAD or gov photo ID), form-i-485
   (receipt notice / pendency evidence), form-i-797c, additional-evidence
   (catch-all, max 5 docs, translations required). All accept jpg/tiff/pdf
   (photo page: jpeg/png; additional-evidence also png).
12. `/review` — alerts per missing item + "Your fee"; **Next (testid
   `next-btn`) is disabled until complete** — successful uploads ENABLE it, so
   the descriptor must mark it `kind:"review"` and the terminal guard must
   cover `/review` on this host path.

## Traps specific to pdf-intake

- **Field names are generic MUI defaults, NOT Formik paths**:
  `controlled-radio-buttons-group` appears on BOTH select-eligibility and
  able-to-pay (different questions!). Anchor radios by their question text
  (captured in each dump as `question`), never by name alone.
- The Formik bridge may not apply here (no Formik path names anywhere);
  value-setting likely needs the native-input path. Verify against
  `engine/value-setter.ts` before assuming.
- The eligibility control is an autocomplete (drive as "search": type, pick
  from `[role=option]`). Option labels in eligibility-options.json.
- Evidence page set swaps with the category **in-page, without Next** (C9 ⇄
  A12 observed live). Selection appears to persist immediately (draft was
  found on A12 with no Next click since).
- Buttons: `next-btn` / `back-btn` testids on every page; upload control text
  is "Choose or drop file here to upload".
- Page titles use distinct names ("USCIS | Upload PDF (I-765)", "USCIS |
  Evidence - Form I-485"), useful as secondary detection signals.

## What the extension/backend build needs from this

- Registry: hostPath `/pdf-intake/I-765/`, caseTypes IR-1/IR-2/IR-5 (C9).
- Descriptor: 3 typed pages + 8 upload pages + review, slugs above (note the
  evidence slugs carry a `/I-765/evidence` suffix).
- Backend map (form_myuscis_definitions.json): eligibility (const C9), reason
  (Initial default / renewal from facts), the 04/01/2024-fee gate (fact),
  client first/middle/last (applicant.*), able-to-pay; upload_pages:
  generated_form I-765 → /form, generated_form G-28 → /form-g28, then
  doc_type-mapped evidence (photo, i94/passport, prior EAD/gov ID, I-485
  receipt, I-797C, catch-all additional-evidence).
- Left OPEN (not captured): what `/form-i-485` shows when the I-485 has no
  receipt yet (concurrent filing), Renewal/Replacement reveals, multi-client
  behavior of `/client-information/{i}`, and the post-review sign/submit page
  (never advanced past review; draft never submitted).

Draft left in the C9 state matching the user's original capture. Draft NOT
submitted; nothing uploaded.
