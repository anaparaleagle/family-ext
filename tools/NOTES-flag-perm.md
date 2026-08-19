# The two DOL PERM forms on flag.dol.gov — what we know before authoring descriptors

Written 2026-08-17, from the first (pass-1) captures plus the backend's ETA maps.

## Where the forms live

    https://flag.dol.gov/dashboard/application/9141/<applicationId>
    https://flag.dol.gov/dashboard/application/9089/<applicationId>

**Not myUSCIS.** This is the same portal the H-1B extension already drives for
the LCA (ETA-9035), and it is a different host from everything else in this
repo — `manifest.json` has no `flag.dol.gov` permission today.

## The navigation model is not the myUSCIS one

Every field in both pass-1 captures came from a SINGLE url. FLAG keeps one
application id in the address bar and switches sections by sidebar click, so
there are no per-page slugs. `FormPage.slug` and the slug-driven walk in
`fill-chain` have nothing to bind to here — a FLAG runner needs a nav-click
strategy, and `findNavItems()` in `flag-capture.js` is the first attempt at
discovering that nav generically.

## The selectors are good news

FLAG's 9141/9089 apps are nothing like the ETA-9035. Where the LCA gives inputs
either a mangled name (`_section_f_f4_work_address_1`) or none at all — which is
why `lca-filler` needs five runtime search strategies and a section detector that
votes on question numbers — the PERM forms give clean, stable, camelCase
name/id pairs:

    #empBusinessName     #attyAgLastName        #primaryWorksiteAddr1
    #appAContDOB         #jobOppPWDNumber       #prepEmail

So PERM can use this repo's exact-name descriptor style. **Do not port the
label-guessing.**

## Four things that will bite

1. **Radio ids are unusable — select by `name` + `value`.** FLAG builds them as
   `<name>_<label>`, and some labels are raw HTML or a whole sentence of
   regulation text:

       jobOppPWDAttached_<span style='color:#707275'>Yes</span>
       occupationType_1a. This application is for a <b>professional occupation</b>...

2. **SOC and NAICS have no name and no id.** They are comboboxes, and the pass-1
   capture recorded them as 12-deep `nth-of-type` chains that will not survive a
   FLAG release. Same widget class that froze the renderer on the LCA's OES
   modal — port the watchdog and iteration cap from `lca-filler.fillSearchField`
   rather than rediscovering that hang.

3. **`#primaryWorksiteCounty` has no `name`,** only an id. Exactly the field the
   H-1B extension is mid-fix on (`fix/lca-section-f-county-oes-overwrite`), and
   for the same reason: the county picks the prevailing-wage area, so a wrong one
   is a wrong wage.

4. **FLAG has profile pickers that populate a whole section.**

       #employer-9141   #employer-pocs-9141   #agent-attorney-individs-9141
       #employer-9089   #employer-pocs-9089   #agent-attorney-individs-9089
       #groupSelect     #fwSelect             (Appendix A foreign worker)

   Selecting a saved profile fills the section for us — a real shortcut, and a
   real hazard: if one fires after we have typed, it overwrites. Decide
   deliberately whether the runner uses them or avoids them; do not let it
   happen by accident.

## The backend join is already exact

`family_visa/forms/eta/maps.py` on the family backend holds 217 mapped boxes
across the two forms, each with its source (org column / fact key / firm profile /
PWD field / derived / default) or a written reason for being blank.

Its keys are the form's own box numbers — `B1`, `C.12`, `F.e.5`. And every FLAG
label starts with that same box number:

    "B.1. Contact’s last (family) name"  ->  B.1
    "F.e.5. County"                      ->  F.e.5

Joining the pass-1 captures against the maps on that key:

| form | boxes reached in capture | matched a map entry | DOM boxes with NO map entry |
|---|---|---|---|
| 9141 | 52 | **52** | **0** |
| 9089 | 61 | **61** | **0** |

Zero orphans on both. The box number is the join key, and `flag-capture.js`
records it on every field for exactly this reason.

## What pass 1 missed, and why

42 mapped boxes on the 9141 and 56 on the 9089 never appeared, all of them behind
a Yes/No nobody clicked:

* **9141** — the E.1a/E.1b/E.4a/E.5a/E.5b wage-source branches, the whole of
  F.b and F.c (education, experience, alternative requirements), F.d.1/F.d.1a
  supervision, F.d.3a travel detail, F.e.7 additional worksites.
* **9089** — Section H recruitment in full, and Appendices A.B (education),
  A.C (training), A.D (skills), A.E (work experience), B and C.

The gating radios themselves WERE captured (`secondDiploma`, `trainingRequired`,
`empExperienceRequired`, `isSpecialRequirements`, `altJobRequirement`,
`otherWorksiteLocation`, `travelRequired`), so we know the doors — just not what
is behind them.

**The pass-1 `revealedBy` is unusable.** It is the cartesian product of every
radio on the form against every one of its values, attached identically to every
field. It was not derived from observation. `flag-capture.js` derives reveals by
diffing the field set before and after each answer instead, and records negative
results too — the N-400 capture showed that a negative control is what makes a
derived rule safe to build on.

## Run 2 (2026-08-17): what the live reveal pass settled

Captured from two throwaway drafts — 9141 `6a831a2313a71d001e967db2`, 9089
`6a831a28e1b3ef001c72d7ab`. Files: `eta9141-reveals-1786977402406.json`,
`eta9089-reveals-1786977257400.json`.

### THE FINDING: the two forms code Yes/No DIFFERENTLY

Every radio's option values are now readable, and they are not what anyone would
have guessed:

| | Yes | No | N/A |
|---|---|---|---|
| **ETA-9141** | `"1"` | `"No"` | `"2"` |
| **ETA-9089** | `"Yes"` | `"No"` | `"N/A"` |

The same logical question — "is the employer covered by ACWIA", "is travel
required" — is `"1"` on one form and `"Yes"` on the other. Writing `"Yes"` to a
9141 radio is silently ignored: no error, box stays blank on a federal form.
**Never share a Yes/No coder between the two forms, and never assume either
spelling.**

Other vocabularies, all captured verbatim:

* `attyRepresentType` / `attyAgRepType` — `Attorney` / `Agent` / `None`
* `primaryEducationLevel` — `NONE`, `HIGHSCHOOLGED`, `ASSOCIATES`, `BACHELORS`,
  `MASTERS`, `DOCTORATEPHD`, `OTHERDEGREE`
* `occupationType` (9089) — `professional_occupation`, `non_professional`,
  `college_university_teacher`, `schedule_a`, `professional_athlete`
* `primaryWorksiteType` (9089) — `1` / `2` / `3` / `4`
* `jobOppWagePer` — `Hour` / `Week` / `Bi-Weekly` / `Month` / `Year`

### Real reveals, with negative controls

* **Attorney block** — `attyRepresentType` = `Attorney` OR `Agent` reveals all
  15 attorney fields on the 9141 (18 on the 9089, via `attyAgRepType`). `None`
  reveals nothing. So the radio must be driven before the block, on both forms.
* **Education** — `primaryEducationLevel` reveals `major` (F.b.1.b) for
  `ASSOCIATES` and above but **not** for `NONE` or `HIGHSCHOOLGED`, and reveals
  `otherEducation` (F.b.1.a) **only** for `OTHERDEGREE`. A clean conditional with
  a working negative control.
* `occupationType` reveals `supervisedRecruitment` for the first four options,
  not for `professional_athlete`.

### THE OTHER FINDING: the missing ~100 boxes are not behind Yes/No at all

This is where run 2 disproved the plan it was built on. F.b Additional Worksites,
H.c Recruitment Information and Appendix A.B Foreign Worker Education each
rendered **zero inputs** — not hidden ones, none. They are **repeaters**: the
fields do not exist until a row is added, so no amount of answering radios will
surface them. Run 2 never clicked an Add button, which is why it found 83 and 127
fields instead of the ~220 the maps describe.

### Four things run 2 got wrong, all fixed in the script

1. **Radios still had no box number** (0 of 15 on the 9141; the 2 on the 9089
   were both wrongly put on E.3, which cannot be right for two different boxes).
   A radio's label is its option text and its fieldset spans several questions.
   The script now captures the surrounding text plus every box number in it, as
   *evidence* — the 31 radios get assigned by hand against the maps' own labels,
   because a cleverer heuristic is the same class of silent mis-assignment that
   has already bitten this table twice.
2. **Reveal results were contaminated.** Five F.b/c gates each reported revealing
   `otherEducation` and `major` on *both* Yes and No — identical results for
   opposite answers, which is contamination, not a reveal.
   `primaryEducationLevel` had been probed first, finished on its last option and
   could not be restored (the draft had never answered it), so those two fields
   stayed rendered for every later gate. Each answer is now diffed against the
   state immediately before it, which is correct whether or not restore works.
3. **Eight real sections were dropped.** The "did the click change anything" guard
   compared field sets, and for a section that renders nothing both sides were
   empty — so F.c, H.d, H.e, Appendices A.C, A.D, A.E, B and C were skipped
   entirely instead of recorded as empty. An absent section reads as "not looked
   at"; an empty one is a finding.
4. **It captured our own extension.** `mk-autofill-section` appeared as a field in
   every section — it is a `<select>` the H-1B extension injects. Now filtered.

## Run the capture on a throwaway draft

The reveal pass types junk into every gating question and FLAG autosaves. Use a
scratch application, never a real filing. `flag-capture.js` refuses to click
anything whose label matches submit / sign / certify / delete / withdraw / pay,
but that guard is a backstop, not a licence.
