// SOF-1685: the online I-130 "Preparer information" section came back BLANK — the
// backend now fills it from the firm's G-28 attorney block (the SAME shared myUSCIS
// "Getting Started" component the I-539 and N-400 already drive), so the descriptor
// must declare that page and its identity fields or the fill-chain has nowhere to
// put the emitted values. These names must stay byte-identical to the backend map
// keys in form_myuscis_definitions.json (IR-1 -> I-130).

import { describe, it, expect } from "vitest";
import { I130_PAGES, descriptorFieldNames } from "../src/i130/form-descriptor";

describe("I-130 preparer section (SOF-1685)", () => {
  const names = new Set(descriptorFieldNames());

  it("declares the /getting-started/preparer page, revealed conditionally", () => {
    const page = I130_PAGES.find((p) => p.slug === "/getting-started/preparer");
    expect(page, "the preparer identity page must exist").toBeDefined();
    // The page only appears once the reveal toggle says a preparer is assisting,
    // exactly like the I-539's — so it must be marked conditional.
    expect(page?.conditional).toBe(true);
  });

  it("drives the firm-sourced preparer identity fields", () => {
    // The six values the backend emits from firm.* plus the no-mobile gate.
    for (const n of [
      "gettingStarted.preparer.name.firstName",
      "gettingStarted.preparer.name.lastName",
      "gettingStarted.preparer.business",
      "gettingStarted.preparer.contact.daytimePhone",
      "gettingStarted.preparer.contact.mobilePhone",
      "gettingStarted.preparer.contact.emailAddress",
      "formikFactoryUIMeta.gettingStarted.preparer.contact.noMobilePhone",
    ]) {
      expect(names.has(n), `descriptor missing ${n}`).toBe(true);
    }
  });

  it("drives the preparer mailing-address block (SOF-1685)", () => {
    // The online I-130 preparer component — unlike the I-539/N-400 — carries an
    // address block; these names must match the backend map (firm.address_*).
    for (const n of [
      "gettingStarted.preparer.address.addressLineOne",
      "gettingStarted.preparer.address.addressLineTwo",
      "gettingStarted.preparer.address.city",
      "gettingStarted.preparer.address.state",
      "gettingStarted.preparer.address.zipCode",
      "gettingStarted.preparer.address.country",
    ]) {
      expect(names.has(n), `descriptor missing ${n}`).toBe(true);
    }
  });

  it("still declares the three reveal toggles the backend now drives", () => {
    for (const n of [
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.hasHelper",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasPreparer",
      "formikFactoryUIMeta.gettingStarted.preparerAndInterpreterInformation.helper.hasInterpreter",
    ]) {
      expect(names.has(n), `descriptor missing ${n}`).toBe(true);
    }
  });
});
