# Online I-131 capture — report (2026-09-15)

Draft `555dda9e-e712-3cdc-b12a-b3eaa30d6d48` (user supplied the draft and granted
claude-in-chrome permission; Claude drove the capture live). Host base:

    https://my.uscis.gov/pdf-intake/I-131/<draftId>/<slug>

Files: `01`–`10`, one per page of the **Advance Parole** walk, in order. Plus
`branch-reentry-permit-select-eligibility.json` (captured live) and five more
`branch-*-select-eligibility.json` files (**derived, not live — see "What is not
live" below**), and `eligibility-options.json`.

Same `pdf-intake` product as the I-485 and I-765 — same `next-btn`/`back-btn`
testids, same "upload the finished PDF" premise — but the walk is half the length
of the I-485 and the evidence list is **not** fixed. Read this next to
`../i485-online-field-dump/NOTES.md`; the deltas are the point.

## FIRST, THE GATING QUESTION — the category exists

**Yes.** "Advance Parole Document (for aliens who are inside the United States) and
Advance Permission to Travel for Commonwealth of Northern Mariana Islands (CNMI)
Long-Term Residents" is option 4 of 7, value **`ADVANCE_PAROLE`**. The live label
carries a CNMI tail that the shorthand name omits — match on the value, or on a
`startsWith("Advance Parole Document")` prefix, never on the full string.

Better still for us: it has a subcategory **`PENDING_485` — "A pending Form I-485,
Application to Register Permanent Residence or Adjust Status"**, which is exactly the
IR-1/IR-2/IR-5 posture. That pair (`ADVANCE_PAROLE` + `PENDING_485`) is the primary
walk captured here.

## THE HEADLINE

- **10 pages**: 2 typed (select-eligibility, client-information/0), 7 upload
  (I-131 PDF, G-28 PDF, 5 evidence slots), then review.
- **No `able-to-pay` page at all.** The I-485 had it as page 2. `ADVANCE_PAROLE` is
  `feeWaivable: false`, and `PENDING_485` is `feeWaivable: false` too, so the
  fee-waiver step never renders on this branch. It is *not* gone from the form —
  4 of the 7 categories are fee-waivable, so a descriptor keyed only on I-131 must
  treat `able-to-pay` as **conditional on the chosen category/subcategory**.
- Evidence slug shape is `/<doc-slug>/I-131/evidence` (the I-485 used
  `/I-485/evidence`), so the suffix tracks the form type.
- No "PDF Intake BETA Preview!" banner, same as the I-485. `showBanner: false` in
  the form metadata confirms it.

## Page 01 `/select-eligibility` — TWO levels, not three

The I-485 asked who → which track → which relationship. The I-131 asks only
**category → subcategory**:

1. `eligibility-choice` — MUI **Select** (`role=combobox` with `[role=option]`
   children, each carrying a `data-value`), 7 categories plus a `Select one`
   placeholder whose value is `""`. Full list with codes in
   `eligibility-options.json`.
2. `<category>-subcategories` — radio list, revealed in-page, **group name built
   from the value of control 1**: here `ADVANCE_PAROLE-subcategories`. Only 4 of the
   7 categories have one; the other 3 render no radios at all.

There is **no** `eligibility-category-choice` middle control and **no** Six-and-Six
radio. **Nothing on this page has a non-empty default** — unlike the I-485, where
the Six-and-Six radio arrived pre-checked "No".

`next-btn` is disabled until a subcategory is picked; for the 3 subcategory-less
categories it enables the moment the category is chosen. Switching category clears
the subcategory and re-disables Next, in-page, with no navigation. Selections
persist immediately without Next (verified by a full reload).

**Trap for a field matcher:** the subcategory radio list has no `<legend>` the
capture could resolve, so `field.question` comes back `""`. The real question is the
category's `subCategoryHeader`, which renders as an `<h2>`/`.MuiFormLabel-root` and
is captured in `question_texts[1]` / `headings_all[2]`. Anchor on that, not on a
legend.

## Page 02 `/client-information/0` — captured in its *populated* state

This draft already has a client attached, so the page rendered its **has-client**
shape: only `firstName` / `middleName` / `lastName` (real ids, `label[for]` wired,
placeholders `John` / `Smith`), **no Add Client button**, and `next-btn` **enabled**
on arrival.

The I-485 dump captured the same page in its **empty** state, where it also carries
`aNumber` + `aNumberCheckbox`, `dateOfBirth` and `emailAddress` — the three fields
with no `<label for>`, wired by `aria-labelledby` — behind an Add Client gate. So:

- The 7-field shape is the empty state; the 3-field shape here is the has-client state.
- **The `aria-labelledby` trap could not be re-checked on the I-131** — those three
  fields never rendered. Assume it still applies.
- Next was **not** clicked here (it would re-save the existing client). The walk
  continued by typing the `/form` URL, which the app allows.

## The 5 evidence pages — a list that VARIES BY CATEGORY

**This is the big difference from the I-485, where all 14 slots appeared for every
combination.** On the I-131 the slot list is per-category, and it was proven live:

| category | slots |
|---|---|
| `ADVANCE_PAROLE` | applicant-photo, photo-id, **form-i-797, form-i-797c**, additional-evidence (**5**) |
| `REENTRY_PERMIT` | applicant-photo, photo-id, additional-evidence (**3**) |

Both were read live from the sidebar after switching category, and both matched the
form metadata exactly. Every category carries `applicant-photo`, `photo-id` and
`additional-evidence`; the middle slots are what change. The per-category lists for
all 7 are in `eligibility-options.json` under `evidence_groups_by_category`.

Subcategories can **further remove** slots via `evidenceCategoriesToExclude` — e.g.
`ADVANCE_PAROLE` + `DEFERRED_ENFORCED_DEPARTURE` drops both I-797 slots. Not
verified live.

So the descriptor **cannot hard-code the evidence pages for I-131** the way it can
for I-485. Derive them from the chosen category.

Accept lists — three shapes on this branch, and note they are **not** byte-identical
to the I-485's equivalents:

- `image/jpeg,.jpeg,.png,.jpg` — applicant-photo and photo-id. Same *set* as the
  I-485 photo page but a **different order** (`.png` and `.jpg` are swapped).
  **Compare accept lists as a set, never as a string.** No PDF on `photo-id`, which
  is a real trap: a passport scan is very often a PDF.
- `image/jpeg,.jpeg,.jpg,.tif,.tiff,application/pdf,.pdf` — form-i-797, form-i-797c.
  No png.
- `image/jpeg,.jpeg,.jpg,.tif,.tiff,.png,application/pdf,.pdf` — additional-evidence.

All are `multiple: true`, but the metadata caps `applicant-photo` and `photo-id` at
`maxNumberOfFiles: 1` and the rest at 200 — so `multiple` on the element is not the
real limit. In-page copy still says max 5 documents at a time, 12MB per file.
`/form` and `/form-g28` are `application/pdf,.pdf` only.

## The four things you asked to have pinned down

1. **Does the evidence slot list vary by category?** **Yes** — 5 slots for
   `ADVANCE_PAROLE`, 3 for `REENTRY_PERMIT`, verified live; full table above. This is
   the opposite of the I-485.
2. **Which testids do Next/Back use?** Unchanged from the I-485 and I-765:
   **`next-btn`** and **`back-btn`**. `/select-eligibility` has `next-btn` only (no
   Back). Every other page has both. Neither carries an `id`.
3. **Does an empty evidence page need two Next clicks?** **Yes**, exactly as on the
   I-485, on all five slots. The first click injects a **"Missing Evidence"** box
   above the buttons — *"It does not appear that you have uploaded any evidence. USCIS
   recommends you provide evidence to support your application. Failure to provide
   required evidence may delay processing of your application."* — and does not
   navigate. The second click advances. **The two clicks must be separated**: two
   rapid clicks coalesce into a double-click and count as one, and the page stays put.
4. **Any control that only responds to real browser events?** **Yes, all of them.**
   Programmatic `el.click()` is ignored on `[data-testid=next-btn]`, on the
   `[role=option]` rows and on the subcategory radios — same as the I-485. The
   eligibility Select additionally needs a real **mousedown** to open (it does not
   open on a synthetic `click`), and once open it is fully keyboard-drivable: the
   listbox puts **DOM focus on the currently-selected `[role=option]`**, so
   ArrowUp/ArrowDown then Enter selects, with `document.activeElement` readable as a
   progress check. The driver must dispatch real (trusted) input events on this host.

## Page 10 `/review`

`next-btn` is **DISABLED** while items are missing, so a successful run ENABLES it —
same terminal-guard trap as the I-485/I-765/N-400. Mark the page `kind:"review"` and
make the terminal guard cover `/review` on this host path.

Only **two** alerts ("Your Form I-131 is missing", "Your Form G-28 is missing"), each
with an "Edit my responses" button. **The five evidence slots raise no review alert**
— they only warn in-page at Next time. Review alerts are not a sufficient
completeness check.

Fee line read **"Your form filing fee is: $0.00"** on this incomplete draft, and the
form metadata carries `fees: null`. Treat it as unverified, not as the real I-131 fee.

## The read-only metadata endpoint is the cheap way in

    GET /pdf-intake/api/intake/forms/I-131/metadata

returns, with no draft and no writes: all 7 categories with codes, labels,
`subCategoryHeader`, every subcategory with its `applicationReasonCode` /
`benefitTypeCodeOverride` / `feeWaivable` / `evidenceCategoriesToExclude`, and the
per-category evidence groups with accept lists and file caps. Also
`currentEdition: "01/20/25"` (expires 06/30/2027, OMB 1615-0013, 14 pages),
`signaturePages: [{applicant: 11}, {representative: 13}]`,
`landmarks: {signature_page_number: 11, name_extract_page_number: 1}`,
`feeWaiverEnabled: true`, `representativeEnabled: true`.

Everywhere the live DOM and this endpoint were both observed, they agreed exactly.
It is the right source for the category/evidence matrix; use the live walk for DOM
shape and for the interaction traps.

## What is NOT live in this folder

Five of the six branch files — `refugee-travel-document`, `tps-travel-authorization`,
`initial-parole`, `parole-in-place`, `reparole-new-period` — are **derived from the
metadata endpoint, not captured live.** Partway through the branch sweep the browser
session stopped delivering mouse and keyboard input to the page (verified with
capturing `pointerdown`/`mousedown`/`click`/`keydown` listeners: zero events arrived,
on a fresh tab as well), so no further category could be selected in the UI.

Each of those five files carries `"_source": "metadata-api"` and says so in its
`_note`. In them the option codes, labels, headers, evidence groups, accept lists and
caps are authoritative server data; the **DOM wrapper is inferred** from the two
categories that were captured live plus the I-485 dump. They also carry an extra
`evidence_groups` key the live page files do not have. **Re-capture them live before
trusting their DOM shape.**

Also left open, as on the I-485: the Add Client flow and multi-client
`/client-information/{i}`, and everything past review (sign / pay / submit).

## What the extension/backend build needs from this

- Registry: hostPath `/pdf-intake/I-131/`, entered for IR-1/IR-2/IR-5 as the
  advance-parole companion to a pending I-485.
- Descriptor: 2 typed pages + 2 PDF uploads + **N evidence pages derived from the
  category** + review. Evidence slugs carry the `/I-131/evidence` suffix and need the
  double-Next. `able-to-pay` is conditional on category/subcategory fee-waivability
  and does **not** appear on our branch.
- Backend map (form_myuscis_definitions.json): `eligibility-choice` = const
  `ADVANCE_PAROLE`, `<category>-subcategories` = const `PENDING_485` for the family
  portal, then client first/middle/last. Upload pages: generated_form I-131 →
  `/form`, generated_form G-28 → `/form-g28`, then doc_type-mapped evidence across
  the 5 advance-parole slots.

## State the draft was left in

Nothing was submitted, paid for, or signed. No file was uploaded. No client was
added. Nothing was deleted.

Page 01 was changed: it arrived **empty** (no category, Next disabled), was set to
`ADVANCE_PAROLE` / `PENDING_485` for the walk, and was then switched to
`REENTRY_PERMIT` for the branch capture. **Input died before it could be switched
back, so the draft is currently sitting on `REENTRY_PERMIT` with no subcategory.**
It needs one manual fix: open
`/pdf-intake/I-131/555dda9e-e712-3cdc-b12a-b3eaa30d6d48/select-eligibility` and set
the category back to Advance Parole, then the "A pending Form I-485" radio. No other
page was modified — Next was never clicked on `/client-information/0`, and the
upload, evidence and review pages were only read.
