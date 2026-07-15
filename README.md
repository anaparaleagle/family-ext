# paraleagle-family-ext

Chrome MV3 extension that autofills the **guided online myUSCIS forms** on
`my.uscis.gov` from the family-visa FACT store. The family analog of
`paraleagle-ext` (which does the H-1B I-129), built clean rather than cloned:
**harvest the proven engine, build a thin clean shell, test what can be tested.**

Two forms are supported — the only family forms with a guided online myUSCIS
surface (I-485/I-765/I-131/I-864/G-28 are paper-only):

| Form | Host path | Status |
|---|---|---|
| **I-130** Petition for Alien Relative | `/forms/petition-for-a-relative/` | Live-verified 2026-06-26; backend map exists. |
| **I-539** Extend/Change Nonimmigrant Status | `/forms/application-to-extend-change-nonimmigrant-status/` | Descriptor built from a live capture; **blocked on the backend map** (see below). |

## Architecture

```
popup (Firebase login, shared project paraleagle-f3a7f)
  └─ GET /api/v1/forms/myuscis-preview/?case=&form_type=<I-130|I-539>  (family backend)
       → { field_values: { "<formik name>": "<value>" }, documents: { upload_pages } }
  └─ chrome.storage.local
       └─ content script on my.uscis.gov   (toolbar + fill-chain + page detection)
            └─ formik-bridge (MAIN world)   → React-fiber setFieldValue
            └─ doc-uploader                 → I-130A + evidence uploads
       └─ download-proxy (service worker)   → authenticated file download
```

**One runner, many forms.** `src/runner/` is form-agnostic mechanism; each form
contributes only a descriptor (`src/<form>/form-descriptor.ts`) plus one entry in
`src/runner/registry.ts`. The content script picks the `FormConfig` whose
`hostPath` matches the current URL, and everything downstream is driven by it.
Adding a third form should touch no runner code.

**Thin extension, smart backend.** The extension is data-agnostic: it receives
`{ field_name: value }` and types it. It does NOT understand family-visa data.
The I-130's applicant/beneficiary **inversion** (online `applicant.*` =
petitioner; online `beneficiary.*` = relative) is applied entirely backend-side
in `form_myuscis_definitions.json` — never re-applied here. The I-539 has a
single `applicant.*` party and **no inversion**; do not let the I-130 trap leak.

### Source layout

```
src/
  engine/                     The harvested, data-agnostic machinery
    formik-bridge.ts          MAIN-world React-fiber setFieldValue (HARVESTED, intact)
    value-setter.ts           Generic value-setting waterfall (HARVESTED + genericized)
    doc-uploader.ts           DataTransfer attach + 5-file batching (HARVESTED)
    download-proxy.ts         Background worker authenticated download (HARVESTED)
    firebase.ts               Shared Firebase init (HARVESTED)
    types.ts, logger.ts       Engine support
  runner/                     Form-agnostic runner (shared by every form)
    types.ts                  FormPage/DescriptorField/RepeaterSpec/FormConfig + helpers
    registry.ts               FORM_CONFIGS: which forms we drive, keyed by hostPath
    section-detector.ts       Detect current sub-page (URL slug → heading)
    fill-chain.ts             Page-walk: plan + fill + repeater Add + Next navigation
    audit.ts                  "Audit page": descriptor vs live DOM drift report
    doc-flow.ts               Resolve upload descriptors → files → attach
    payload.ts                The single data contract + storage keys
    content.ts                Toolbar UI + orchestration glue
  i130/form-descriptor.ts     I-130 pages/fields ONLY (no mechanism)
  i539/form-descriptor.ts     I-539 pages/fields + the documented skip list
  popup/                      Firebase login, case picker, form picker, preview-load
test/                         vitest + happy-dom
```

Dependency direction: `engine` ← `runner` ← `<form>/form-descriptor`. The engine
never imports the runner; a descriptor never imports the runner's mechanism
(only its types). The one deliberate edge is `runner/registry.ts`, which imports
each descriptor — that is the composition root.

## Build & load

```bash
npm install
npm run build        # one-shot → dist/   (production: console.* dropped)
npm run watch        # rebuild on change; adds http://localhost/* to host_permissions
```

Load `dist/` as an unpacked extension at `chrome://extensions` (Dev mode on).

## Test

```bash
npm test             # vitest run (happy-dom)
npm run typecheck    # tsc --noEmit (strict)
```

The Formik React-fiber bridge cannot be unit-tested (happy-dom has no React
fiber) — it is covered by live agent-browser verification. The tests cover the
value-setter's non-bridge strategies (text/radio/select/checkbox/phone), the
fill-chain planning + DOM page-fill + repeater Add/index, section detection,
upload-page matching, the config registry, the navigation safety guards, the
audit report, and two coverage cross-checks:

- `coverage.test.ts` — I-130 descriptor ↔ the backend value map.
- `i539-coverage.test.ts` — I-539 descriptor ↔ the **live field dump**
  (`paraleagle-dev/i539-online-field-dump/`). Every one of the 113 fillable
  fields myUSCIS renders is either driven (84) or in the documented
  `I539_SKIP` list (29) — nothing may fall between. There is no I-539 backend
  map to check against yet, so the dump is the source of truth.

## I-539: what is blocked

The extension side is done and unit-tested, but a live I-539 fill needs:

1. **The backend map** — `form_myuscis_definitions.json` has no `I-539` block,
   and `MyuscisPreviewView.SUPPORTED_FORM_TYPES` is `{"I-130"}`, so requesting
   I-539 returns 400 (the popup surfaces the reason verbatim). Until that lands
   the popup can select I-539 but cannot load data.
2. **Two display-text transforms** — `currentNonImmigrantStatus` and
   `statusInfo.changeOfStatus` are MUI autocompletes that filter by USCIS
   DISPLAY TEXT, not the code ("F1" will not match; "Student, Academic Or
   Language Program." does). The backend must emit the display text. Option
   lists: `i539-online-field-dump/misc/*-options.json`.
3. **The review page was never captured** — its slug is unknown, so it is
   deliberately absent from `I539_PAGES`. The walk treats it as unrecognized;
   the backstop is the fill-chain's Submit/Pay/e-sign guard, which refuses to
   click those controls whatever their test-id. Capture it before a live run.
4. **Upload descriptors** — the three `/evidence/*` pages need backend
   `upload_pages` entries to resolve to bytes; without them the doc-flow logs a
   skip.

## What is harvested vs built fresh

| File | Source |
|---|---|
| `engine/formik-bridge.ts` | HARVESTED intact from `paraleagle-ext` `src/content/formik-bridge.ts` (origin/main; working tree was identical). |
| `engine/value-setter.ts` | HARVESTED + genericized from `paraleagle-ext` `src/content/i129-filler.ts` value-setter waterfall (origin/main). I-129 field-map specifics left behind. |
| `engine/doc-uploader.ts` | HARVESTED from `paraleagle-ext` `src/content/i129-doc-uploader.ts` on `fix/i129-doc-upload-batching` (the 5-file batching version). Doc-map specifics stripped. |
| `engine/download-proxy.ts` | HARVESTED from `paraleagle-ext` `src/background.ts` (origin/main); re-pointed at family API origins. |
| `engine/firebase.ts` | HARVESTED from `paraleagle-ext` `src/lib/firebase.ts` (origin/main). |
| Everything in `i130/`, `popup/`, configs, tests | Built fresh. |

`formik-bridge` / `value-setter` / `download-proxy`: the `paraleagle-ext`
working-tree copies were byte-identical to `origin/main`, so the harvested
versions ARE the stable baseline.

## Live verification (deferred — needs Docker + a live myUSCIS draft)

Run end-to-end on a DRAFT I-130 only — never Submit/Pay/e-sign. See the
agent-browser recipe in the family-ext operating notes. Checklist:

1. Bring up the family backend (Docker, host `:8001`) and confirm the seeded
   Okafor case **PA-2049** returns sane `field_values` from
   `GET /api/v1/forms/myuscis-preview/?case=PA-2049&form_type=I-130`.
2. Load `dist/` via `agent-browser --extension`; log into the popup; load PA-2049.
3. On a live I-130 draft, run Fill section / Fill all page by page; confirm the
   Formik bridge commits values (the spike already proved this once).
4. Confirm the applicant/beneficiary inversion reads correctly (petitioner
   Daniel into the `applicant.*` "About You" pages; relative Maya into the
   `beneficiary.*` pages).
5. Reach (and fill prerequisites for) the two spouse-conditional pages the spike
   could not capture; capture their field names and fold into the descriptor.
6. Doc uploads: confirm the `documents/` list resolution + the generated I-130A
   PDF fetch attach correctly. Both URLs come from the verified backend
   contract — `DocumentSerializer.file_url` (GET `/documents/?case=`) and
   `GeneratedFormSerializer.file_url` (GET `/forms/generated/?case=`). The
   I-130A must have been generated in ParaLeagle first (the backend fills the
   PDF only via the staff `generate` action); if absent, the extension warns
   instead of attaching nothing silently.
7. Delete the throwaway draft.
```
