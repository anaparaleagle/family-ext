# paraleagle-family-ext

Chrome MV3 extension that autofills the **online Form I-130 (Petition for Alien
Relative)** on `my.uscis.gov` from the family-visa FACT store. The family analog
of `paraleagle-ext` (which does the H-1B I-129), built clean rather than cloned:
**harvest the proven engine, build a thin clean shell, test what can be tested.**

Scope is exactly one form: the I-130. It is the only family form with a guided
online myUSCIS surface (I-485/I-765/I-131/I-864/G-28 are paper-only).

## Architecture

```
popup (Firebase login, shared project paraleagle-f3a7f)
  └─ GET /api/v1/forms/myuscis-preview/?case=&form_type=I-130   (family backend)
       → { field_values: { "<formik name>": "<value>" }, documents: { upload_pages } }
  └─ chrome.storage.local
       └─ content script on my.uscis.gov   (toolbar + fill-chain + page detection)
            └─ formik-bridge (MAIN world)   → React-fiber setFieldValue
            └─ doc-uploader                 → I-130A + evidence uploads
       └─ download-proxy (service worker)   → authenticated file download
```

**Thin extension, smart backend.** The extension is data-agnostic: it receives
`{ field_name: value }` and types it. It does NOT understand family-visa data.
The applicant/beneficiary **inversion** (online `applicant.*` = petitioner;
online `beneficiary.*` = relative) is applied entirely backend-side in
`form_myuscis_definitions.json` — never re-applied here.

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
  i130/                       The clean I-130 shell (built fresh)
    form-descriptor.ts        Page order, slugs, field kinds, repeaters, uploads
    section-detector.ts       Detect current sub-page (URL slug → heading)
    fill-chain.ts             Page-walk: plan + fill + repeater Add + Next navigation
    doc-flow.ts               Resolve upload descriptors → files → attach
    payload.ts                The single data contract + storage keys
    content.ts                Toolbar UI + orchestration glue
  popup/                      Firebase login, case picker, preview-load
test/                         vitest + happy-dom
```

The engine never imports `i130`; `i130` only imports the engine's public
modules. This boundary is enforced by review (and is currently clean).

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
upload-page matching, and a coverage cross-check against the backend value map.

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
