// Detect which I-130 sub-page we're on. Primary signal is the URL slug (the
// online form is an SPA whose path ends with the descriptor slug); fallback is
// the page heading. Kept independent of the fill-chain so it can be unit-tested.

import { FormPage, I130_PAGES } from "./form-descriptor";

/** Find the descriptor page whose slug the URL path ends with. */
export function pageForUrl(url: string): FormPage | null {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/$/, "");
  } catch {
    path = url.replace(/\/$/, "");
  }
  // Longest slug first so nested slugs (…/your-parents/your-parents) win over
  // their prefixes (…/your-parents).
  const byLength = [...I130_PAGES].sort((a, b) => b.slug.length - a.slug.length);
  for (const page of byLength) {
    if (path.endsWith(page.slug)) return page;
  }
  return null;
}

/** Fallback: match the first heading text against a page title. */
export function pageForHeading(headingText: string): FormPage | null {
  const h = headingText.trim().toLowerCase();
  if (!h) return null;
  for (const page of I130_PAGES) {
    const title = page.title.toLowerCase();
    if (h.includes(title) || title.includes(h)) return page;
  }
  return null;
}

/**
 * Detect the current page from the live document: URL first, heading second.
 * Returns null when neither matches a known I-130 page.
 */
export function detectCurrentPage(doc: Document = document): FormPage | null {
  const byUrl = pageForUrl(doc.location?.href ?? "");
  if (byUrl) return byUrl;

  const heading = doc.querySelector("h1, h2, h3");
  return heading ? pageForHeading(heading.textContent ?? "") : null;
}
