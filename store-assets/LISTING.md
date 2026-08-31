# Chrome Web Store listing — ParaLeagle Family Form Autofill

Everything the developer dashboard asks for, written out so it can be pasted
rather than improvised. Keep this file in step with the manifest.

Dashboard: https://chrome.google.com/webstore/devconsole

Upload: `paraleagle-family-ext-v0.9.0-webstore.zip` (repo root, gitignored —
rebuild with `npm run build` then re-zip the CONTENTS of `dist/`).

---

## 0. Before the first upload

One-time, on the account that will own the item:

1. A Chrome Web Store developer account costs **$5, one time**. Pay it once per
   account, not per extension — so if this item goes on the account that already
   owns the published H-1B item (`imcfojejfmpkepmanakogmooejclmgnl`), there is
   nothing more to pay. Confirm that account is the TEAM account before creating
   the item.
2. Add and verify a **contact email** under Account. Publishing is blocked until
   that is verified.
3. Optional but worth it: verify the **paraleagle.ai** domain, so the listing can
   say "by ParaLeagle" instead of showing a bare email address.

Publish from the **team account**, never a personal one. Whoever owns the item
owns every future update, and an item cannot be moved between accounts — only
re-published under a new ID, which orphans every install.

---

## 1. Package

The zip holds the CONTENTS of `dist/`, so `manifest.json` sits at the zip root.
A zip with a `dist/` folder inside it is rejected.

Version numbers cannot be reused. Every upload needs a higher `version` in
`manifest.json` (and `package.json`, which is kept in step by hand).

---

## 2. Store listing tab

Every prose field below is a FILE under `store-assets/listing/`. Open the file,
select all, copy, paste. Do not retype it, do not summarise it, and never copy
listing text out of a chat window, an email or this document — that is exactly
how the "Yellow Argon" rejection happened (section 6).

**Title**

    ParaLeagle Family Form Autofill

**Summary** (132 characters max) — paste `store-assets/listing/summary.txt`

The dashboard pre-fills this box from the manifest `description` and leaves it
editable. It does not refresh itself on a later upload, so paste the file over
whatever is sitting there — on 2026-08-29 the live item was still showing the
0.8.3 manifest string here, because this box was never touched.

**Description** — paste `store-assets/listing/description.txt`

**Category**

    Workflow & Planning

**Language**

    English (United States)

**Store icon** — `store-assets/store-icon-128.png` (128x128, padded per spec).

**Screenshots** — at least one, 1280x800 or 640x400, PNG or JPEG. Up to five.
Worth capturing, in this order:

1. The toolbar on a guided my.uscis.gov form, mid-fill, showing the filled count.
2. The popup: signed in, a case selected, the form picker.
3. A document page with attachments in place.

Screenshots are public even on an unlisted item. Use a demo case — no real
client name, A-number, date of birth or address anywhere in the frame.

---

## 2.5 Test instructions — the Build tab

The reviewer-notes field is called **Test instructions** and lives under **Build**,
not on the Privacy tab. Fill it. Do not leave it blank.

**Do not hand over a ParaLeagle login.** Firm accounts hold real client
immigration records. The H-1B item (`imcfojejfmpkepmanakogmooejclmgnl`) was
approved with notes of exactly this shape and no credentials, and the rejection
before it was a static scan of the bundle and the manifest — nothing in it
suggests a human tried to sign in.

Paste `store-assets/listing/test-instructions.txt`.

If they come back citing non-functionality, THEN provision the demo tenant. Do
not appeal a violation that is real — it costs days and clears nothing.

---

## 3. Privacy practices tab

**Single purpose** — paste `store-assets/listing/single-purpose.txt`

**Permission justifications**

`storage`

    Holds the signed-in user's session token and the case data loaded for the
    form currently being filled, so the toolbar on the page can use it. It stays
    in local extension storage on the user's own machine and is cleared on sign
    out, and the case data expires 30 minutes after it is loaded.

Host permission — `https://my.uscis.gov/*`

    One of the two sites the extension fills. The content script renders the
    fill toolbar and sets field values on the guided online forms there.

Host permission — `https://flag.dol.gov/*`

    The Department of Labor's FLAG portal, where Form ETA-9141 is filed. Same
    content script, same job as the USCIS site: it renders the fill toolbar and
    sets field values on the form the user already has open.

Host permission — `https://family-api.paraleagle.io/*`

    ParaLeagle's own API. The extension fetches the case data to be filled from
    it, using the signed-in user's token. It is the only place that token is
    ever sent.

Host permissions — `https://*.s3.amazonaws.com/*`, `https://s3.amazonaws.com/*`,
`https://*.s3.us-east-1.amazonaws.com/*` and `https://s3.us-east-1.amazonaws.com/*`

    Four patterns because a presigned link arrives in either the virtual-hosted
    or the path style, and in either the global or the us-east-1 form.

    Supporting documents the firm uploaded to ParaLeagle are stored in Amazon
    S3, and ParaLeagle's API returns time-limited links directly to S3. The
    extension downloads those files so it can attach them to the form's upload
    pages. Only file bytes are fetched, and no ParaLeagle credentials are sent
    to S3 — the links carry their own short-lived signature.

**Remote code**

    No, I am not using remote code. All JavaScript is bundled in the package.

**Data usage** — check these two, and nothing else:

- Personally identifiable information — the names, addresses, dates of birth and
  immigration history that go into the form.
- Authentication information — the ParaLeagle sign-in and its session token.

Do NOT check: health, financial, location, web history, user activity, personal
communications. The extension collects none of them.

All three certifications are true and can be checked:

- Not sold or transferred to third parties outside the approved use cases.
- Not used or transferred for anything unrelated to the single purpose above.
- Not used for creditworthiness or lending.

**Privacy policy URL**

    https://www.paraleagle.ai/privacy

That page exists and already describes immigration and petition data. Note the
marketing site's own footer links to `paraleagle.com/privacy`, and that domain
does not resolve — a separate thing to fix, but a reviewer who clicks it will
see a dead link.

---

## 4. Distribution tab

    Visibility:  Unlisted
    Pricing:     Free
    Regions:     All

Unlisted means: not searchable, not browsable, installable by anyone with the
link. It is still fully reviewed by Google. Only pick Private if the team
account is a Google Workspace account and you want to hard-limit installs to the
domain.

---

## 5. After it is published

Send firm users the item link, and tell them one thing first:

    Remove the sideloaded copy before installing this.

The store assigns the extension a new ID, so the store copy and a copy loaded
from a folder are two separate extensions. Both inject a toolbar into the same
my.uscis.gov page, and two toolbars fight.

Expect review to take anywhere from a few hours to a few days. Host permissions
on a government site and PII handling are the two things that slow it down.

To ship an update: bump `version` in `manifest.json`, `npm run build`, re-zip
`dist/`, upload as a new package on the same item. Installed copies update
themselves within a few hours.

---

## 6. Verify what actually shipped

Run this after every submission, and again after it goes live:

    npm run check:listing

It fetches the item's PUBLIC detail page — no login, so it cannot be fooled by a
stale dashboard draft — and diffs the two paragraphs the store shows against
`summary.txt` and `description.txt`. Exit 0 means the live listing is the text in
this repo. Anything else it prints line by line.

**Why this exists.** On 2026-08-29 the item was rejected, "Keyword spam",
violation reference **Yellow Argon**:

    Having excessive and/or irrelevant keywords in the item's description

The description on the dashboard was the 0.8.3 description with two paragraphs of
chat commentary about the upload pasted onto the end of it:

    Keep the three named. Don't list forms that aren't built yet — overclaiming
    is its own rejection risk.

    One thing this doesn't fix: the manifest description also names the three
    forms, and that's the string on the extension's card. It's baked into the
    0.8.3 zip you just uploaded, so leave it — ...

A paste overrun. The package was clean, every guard in `test/store-build.test.ts`
was green, and nothing in the repo could see it, because the dashboard was the
only place that text existed. Hence the files in `store-assets/listing/`, which
are copied whole, and this check, which reads the result back.
