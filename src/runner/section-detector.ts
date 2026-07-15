// Detect which sub-page of a guided online form we're on. Primary signal is the
// URL slug (these forms are SPAs whose path ends with the descriptor slug);
// fallback is the page heading. Form-agnostic: the caller passes the descriptor
// pages, so the same detector serves the I-130 and the I-539.
//
// Kept independent of the fill-chain so it can be unit-tested without a walk.

import { FormPage } from "./types";

/** Find the descriptor page whose slug the URL path ends with. */
export function pageForUrl(pages: FormPage[], url: string): FormPage | null {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/$/, "");
  } catch {
    path = url.replace(/\/$/, "");
  }
  // Longest slug first so nested slugs (…/your-parents/your-parents) win over
  // their prefixes (…/your-parents).
  const byLength = [...pages].sort((a, b) => b.slug.length - a.slug.length);
  for (const page of byLength) {
    if (path.endsWith(page.slug)) return page;
  }
  return null;
}

/** Fallback: match the first heading text against a page title. */
export function pageForHeading(pages: FormPage[], headingText: string): FormPage | null {
  const h = headingText.trim().toLowerCase();
  if (!h) return null;
  for (const page of pages) {
    const title = page.title.toLowerCase();
    if (h.includes(title) || title.includes(h)) return page;
  }
  return null;
}

/**
 * Detect the current page from the live document: URL first, heading second.
 * Returns null when neither matches a known page of this form.
 */
export function detectCurrentPage(pages: FormPage[], doc: Document = document): FormPage | null {
  const byUrl = pageForUrl(pages, doc.location?.href ?? "");
  if (byUrl) return byUrl;

  const heading = doc.querySelector("h1, h2, h3");
  return heading ? pageForHeading(pages, heading.textContent ?? "") : null;
}
