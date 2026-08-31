#!/usr/bin/env node
//
// Compare what the Chrome Web Store is ACTUALLY showing against the text we
// keep in `store-assets/listing/`. Needs no login: the detail page of an
// Unlisted item is public to any link holder, so a plain fetch sees exactly
// what a reviewer sees, and cannot be fooled by a stale dashboard draft.
//
//   npm run check:listing
//
// The bug this exists for (rejection "Yellow Argon", 2026-08-29): the item was
// published with two paragraphs of chat commentary about the upload stuck on
// the end of the description — "Keep the three named. Don't list forms that
// aren't built yet ... It's baked into the 0.8.3 zip you just uploaded". A
// paste overrun. Nothing in the repo could see it, because the dashboard is
// the only place that text lives. This reads it back.
//
// Exit 0 live matches the files, 1 drift, 2 could not read the page.

import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LISTING_DIR = join(REPO, "store-assets", "listing");
const ITEM_ID = "linmebglkplnkdbiojjlldpmoijkjaag";
const URL_ = `https://chromewebstore.google.com/detail/${ITEM_ID}`;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };

function unescapeHtml(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** The two paragraphs under the listing's "Overview" heading: summary, then description. */
export function overviewParagraphs(html) {
  const start = html.indexOf(">Overview<");
  if (start === -1) return [];
  const section = html.slice(start, html.indexOf("</section>", start));
  return [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => unescapeHtml(m[1]).trim());
}

/** A row of the Details panel, by its visible label. */
export function detail(html, label) {
  const m = html.match(new RegExp(`<div[^>]*>${label}</div><div[^>]*>([^<]+)</div>`));
  return m ? m[1].trim() : "";
}

/** Lines present on one side only — enough to name a paste overrun. */
export function drift(live, expected) {
  const lines = (s) => s.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
  const expectedLines = new Set(lines(expected));
  const liveLines = new Set(lines(live));
  return {
    extra: lines(live).filter((l) => !expectedLines.has(l)),
    missing: lines(expected).filter((l) => !liveLines.has(l)),
  };
}

function field(name) {
  return readFileSync(join(LISTING_DIR, name), "utf-8").trim();
}

function report(label, live, expected) {
  if (live === expected) {
    console.log(`  OK    ${label}`);
    return true;
  }
  const { extra, missing } = drift(live, expected);
  console.log(`  DRIFT ${label}`);
  for (const l of extra) console.log(`    live only : ${l}`);
  for (const l of missing) console.log(`    file only : ${l}`);
  return false;
}

const res = await fetch(URL_, { headers: { "user-agent": "Mozilla/5.0" } });
if (!res.ok) {
  console.error(`Could not read ${URL_} — HTTP ${res.status}`);
  process.exit(2);
}
const html = await res.text();
const paragraphs = overviewParagraphs(html);
if (paragraphs.length < 2) {
  console.error("Could not find the Overview paragraphs — the store's markup moved. Fix the parser.");
  process.exit(2);
}

console.log(`${URL_}`);
console.log(`  version ${detail(html, "Version") || "?"}, updated ${detail(html, "Updated") || "?"}\n`);

const ok = [
  report("summary", paragraphs[0], field("summary.txt")),
  report("description", paragraphs[1], field("description.txt")),
].every(Boolean);

console.log(ok ? "\nLive listing matches store-assets/listing/." : "\nLive listing does NOT match store-assets/listing/.");
process.exit(ok ? 0 : 1);
