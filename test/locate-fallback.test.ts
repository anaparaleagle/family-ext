// STRUCTURAL + LABEL FALLBACK for a field whose `name` cannot be relied on.
//
// Driven by a real N-400 finding: the current-address "To" date's name attribute
// is a RANDOM UUID (`8742c00f-044a-46a1-ab32-60d2a2611150` on the capture run),
// not a Formik path. Nothing keyed on a name can ever reach it, so the field was
// simply unfillable — and there is no reason to assume USCIS uses that pattern in
// exactly one place.
//
// Two signals, in this order:
//   1. `nearName` — the STABLE named field this one sits beside. For the address
//      date pair that is `...datesOfResidence.fromDate`, whose name we do know.
//      Structure is the stronger signal here.
//   2. `labelContains` — visible label text, as a fallback.
//
// Label text is deliberately NOT primary. The label string we hold for this field
// came out of the capture's own label heuristic, which concatenated the enclosing
// form control's text ("To (MM/DD/YYYY) Present" — where "Present" almost
// certainly belongs to a separate checkbox). Anchoring on a name we verified beats
// matching a string we derived.

import { beforeEach, describe, expect, it } from "vitest";
import { locateElement } from "../src/engine/value-setter";
import type { FieldSpec } from "../src/engine/types";

const FROM = "applicant.yourContactInformation.physicalAddress.datesOfResidence.fromDate";
const UUID = "8742c00f-044a-46a1-ab32-60d2a2611150";

/** The myUSCIS date-pair shape: one properly named input, one UUID-named one. */
function datePair(): void {
  document.body.innerHTML = `
    <div class="MuiFormControl-root">
      <label for="from">From (MM/DD/YYYY)</label>
      <input type="text" name="${FROM}" id="from" />
      <label for="to">To (MM/DD/YYYY)</label>
      <input type="text" name="${UUID}" id="to" />
      <label for="present">Present</label>
      <input type="checkbox" name="present-box" id="present" />
    </div>
  `;
}

describe("locateElement — exact name still wins", () => {
  beforeEach(datePair);

  it("returns the element by name when the name is present", () => {
    // No regression: a stable name must never take the fallback path.
    const spec: FieldSpec = { name: FROM, kind: "text" };
    expect(locateElement(spec)?.id).toBe("from");
  });

  it("prefers the name even when a locate spec is also declared", () => {
    const spec: FieldSpec = {
      name: FROM,
      kind: "text",
      locate: { nearName: FROM, labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)?.id).toBe("from");
  });
});

describe("locateElement — structural anchoring (nearName)", () => {
  beforeEach(datePair);

  it("finds the neighbouring input when the field's own name is absent", () => {
    // This is the whole point: the descriptor names it logically, the DOM does not.
    const spec: FieldSpec = {
      name: "applicant.yourContactInformation.physicalAddress.datesOfResidence.toDate",
      kind: "text",
      locate: { nearName: FROM },
    };
    expect(locateElement(spec)?.id).toBe("to");
  });

  it("never returns the anchor itself", () => {
    const spec: FieldSpec = {
      name: "some.logical.toDate",
      kind: "text",
      locate: { nearName: FROM },
    };
    expect(locateElement(spec)?.id).not.toBe("from");
  });

  it("matches the anchor's input TYPE, so it skips the Present checkbox", () => {
    // The next input after the anchor is the To date; the one after that is a
    // checkbox. Type-matching keeps a text field from resolving to a tickbox.
    const spec: FieldSpec = { name: "logical.toDate", kind: "text", locate: { nearName: FROM } };
    const el = locateElement(spec) as HTMLInputElement;
    expect(el.type).toBe("text");
  });

  it("does not reach into a DIFFERENT container", () => {
    // A second address block must not be filled from the first one's anchor.
    document.body.innerHTML = `
      <div class="MuiFormControl-root">
        <input type="text" name="${FROM}" id="from" />
      </div>
      <div class="MuiFormControl-root">
        <input type="text" name="other-uuid" id="elsewhere" />
      </div>
    `;
    const spec: FieldSpec = { name: "logical.toDate", kind: "text", locate: { nearName: FROM } };
    expect(locateElement(spec)).toBeNull();
  });

  it("returns null when the anchor itself is missing", () => {
    // Loud failure. A silent null here would read as "field absent" when the real
    // problem is that the page changed shape.
    document.body.innerHTML = `<div><input type="text" name="unrelated" /></div>`;
    const spec: FieldSpec = { name: "logical.toDate", kind: "text", locate: { nearName: FROM } };
    expect(locateElement(spec)).toBeNull();
  });
});

describe("locateElement — label fallback", () => {
  it("finds a field by its visible label when there is no usable anchor", () => {
    document.body.innerHTML = `
      <div class="MuiFormControl-root">
        <label for="to">To (MM/DD/YYYY)</label>
        <input type="text" name="${UUID}" id="to" />
      </div>
    `;
    const spec: FieldSpec = {
      name: "logical.toDate",
      kind: "text",
      locate: { labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)?.id).toBe("to");
  });

  it("normalises whitespace before comparing", () => {
    // Captured label text carries collapsed runs of whitespace; the live DOM may
    // have newlines and indentation. Comparing raw text would miss.
    document.body.innerHTML = `
      <div class="MuiFormControl-root">
        <label for="to">To
             (MM/DD/YYYY)</label>
        <input type="text" name="${UUID}" id="to" />
      </div>
    `;
    const spec: FieldSpec = {
      name: "logical.toDate",
      kind: "text",
      locate: { labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)?.id).toBe("to");
  });

  it("uses aria-label when there is no label element", () => {
    document.body.innerHTML = `<input type="text" name="${UUID}" id="to" aria-label="To (MM/DD/YYYY)" />`;
    const spec: FieldSpec = {
      name: "logical.toDate",
      kind: "text",
      locate: { labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)?.id).toBe("to");
  });

  it("falls through to the label when the anchor is gone", () => {
    // Both signals declared, structure unavailable — the fallback is the reason
    // labelContains exists at all.
    document.body.innerHTML = `
      <div class="MuiFormControl-root">
        <label for="to">To (MM/DD/YYYY)</label>
        <input type="text" name="${UUID}" id="to" />
      </div>
    `;
    const spec: FieldSpec = {
      name: "logical.toDate",
      kind: "text",
      locate: { nearName: FROM, labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)?.id).toBe("to");
  });

  it("returns null rather than guessing when nothing matches", () => {
    document.body.innerHTML = `<input type="text" name="x" id="x" aria-label="Something else" />`;
    const spec: FieldSpec = {
      name: "logical.toDate",
      kind: "text",
      locate: { nearName: FROM, labelContains: "To (MM/DD/YYYY)" },
    };
    expect(locateElement(spec)).toBeNull();
  });
});

describe("locateElement — no locate spec", () => {
  it("behaves exactly like findByName", () => {
    datePair();
    expect(locateElement({ name: FROM, kind: "text" })?.id).toBe("from");
    expect(locateElement({ name: "not.on.page", kind: "text" })).toBeNull();
  });
});
