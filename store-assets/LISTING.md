# Chrome Web Store listing — ParaLeagle Family myUSCIS Autofill

Everything the developer dashboard asks for, written out so it can be pasted
rather than improvised. Keep this file in step with the manifest.

Dashboard: https://chrome.google.com/webstore/devconsole

Upload: `paraleagle-family-ext-v0.8.1-webstore.zip` (repo root, gitignored —
rebuild with `npm run build` then re-zip the CONTENTS of `dist/`).

---

## 0. Before the first upload

One-time, on the account that will own the item:

1. A Chrome Web Store developer account costs **$5, one time**. Pay it once per
   account, not per extension.
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

**Title**

    ParaLeagle Family myUSCIS Autofill

**Summary** (132 characters max)

    Fill the guided online I-130, I-539 and N-400 on myUSCIS from your firm's ParaLeagle case data.

**Description**

    ParaLeagle Family myUSCIS Autofill is a tool for immigration law-firm staff
    who already use ParaLeagle. It fills the guided online forms on my.uscis.gov
    from case data the firm has already collected and reviewed in ParaLeagle,
    instead of re-typing it a third time.

    Forms supported:
    - I-130, Petition for Alien Relative
    - I-539, Application to Extend/Change Nonimmigrant Status
    - N-400, Application for Naturalization

    How it works:
    1. Sign in with your ParaLeagle account in the extension popup.
    2. Pick the case and the form you have open on myUSCIS.
    3. Load the case, then use the toolbar on the form to fill page by page,
       or to walk the whole form.

    It also attaches supporting documents the firm has already uploaded to
    ParaLeagle, on the form's document pages.

    Nothing is filled without a signed-in ParaLeagle user asking for it, and the
    extension only ever writes data the firm itself supplied. It does not submit
    anything to USCIS — a person reviews every page and files it.

    A ParaLeagle account is required. The extension is not affiliated with, or
    endorsed by, U.S. Citizenship and Immigration Services.

**Category**

    Workflow & Planning

**Language**

    English (United States)

**Store icon** — `store-assets/store-icon-128.png` (128x128, padded per spec).

**Screenshots** — at least one, 1280x800 or 640x400, PNG or JPEG. Up to five.
Worth capturing, in this order:

1. The toolbar on a guided myUSCIS form, mid-fill, showing the filled count.
2. The popup: signed in, a case selected, the form picker.
3. A document page with attachments in place.

Screenshots are public even on an unlisted item. Use a demo case — no real
client name, A-number, date of birth or address anywhere in the frame.

---

## 3. Privacy practices tab

**Single purpose**

    A single purpose: fill the guided online USCIS forms on my.uscis.gov with
    immigration case data the signed-in user's law firm has already entered in
    ParaLeagle. Every feature serves that one flow — signing in, choosing the
    case, filling the form's fields, and attaching documents the firm has
    already uploaded for that case.

**Permission justifications**

`activeTab`

    Used to read and fill the guided USCIS form in the tab the user is looking
    at when they click the extension's toolbar. Nothing is read from a tab the
    user has not acted on.

`storage`

    Holds the signed-in user's session token and the case data loaded for the
    form currently being filled, so the toolbar on the page can use it. It stays
    in local extension storage on the user's own machine and is cleared on sign
    out, and the case data expires 30 minutes after it is loaded.

Host permission — `https://my.uscis.gov/*`

    This is the only site the extension fills. The content script renders the
    fill toolbar and sets field values on the guided online forms there.

Host permission — `https://family-api.paraleagle.io/*`

    ParaLeagle's own API. The extension fetches the case data to be filled from
    it, using the signed-in user's token. It is the only place that token is
    ever sent.

Host permissions — `https://*.s3.amazonaws.com/*` and the matching
`s3.us-east-1` patterns

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
myUSCIS page, and two toolbars fight.

Expect review to take anywhere from a few hours to a few days. Host permissions
on a government site and PII handling are the two things that slow it down.

To ship an update: bump `version` in `manifest.json`, `npm run build`, re-zip
`dist/`, upload as a new package on the same item. Installed copies update
themselves within a few hours.
