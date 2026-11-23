/**
 * wording-test.test.ts — a wording test: two versions of one offer's email, taking turns in Send email (24 Nov 2026).
 *
 * Inputs:  test rows, send counts, what the operator picked to test
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { armKey, nextVariant, startingEmail, startTestRefusal, testForOffer, type WordingTest } from "./wording-test";

const T: WordingTest = { id: "t1", service_key: "seo", a_key: "service:seo", b_key: "saved:b1", a_label: "SEO (show up higher on Google)", b_label: "SEO short", status: "running", winner: null, started_at: "2026-11-24T00:00:00Z", ended_at: null };

describe("nextVariant (half and half, taking turns)", () => {
  it("whichever version has fewer sends goes next; A on a tie", () => {
    expect(nextVariant(0, 0)).toBe("A");
    expect(nextVariant(1, 0)).toBe("B");
    expect(nextVariant(3, 4)).toBe("A");
  });
});

describe("armKey / testForOffer", () => {
  it("the email key of each version", () => {
    expect(armKey(T, "A")).toBe("service:seo");
    expect(armKey(T, "B")).toBe("saved:b1");
  });
  it("only a running test for that offer", () => {
    expect(testForOffer([T], "seo")).toBe(T);
    expect(testForOffer([T], "website_build")).toBeNull();
    expect(testForOffer([{ ...T, status: "done", winner: "B" }], "seo")).toBeNull();
  });
});

describe("startTestRefusal", () => {
  const templates = [{ id: "b1", archived: false }, { id: "old", archived: true }];
  const ok = { service_key: "seo", a_key: "service:seo", b_key: "saved:b1" };
  it("a ready-made email against a saved template is fine", () => expect(startTestRefusal(ok, [], templates)).toBeNull());
  it("two saved templates are fine", () => expect(startTestRefusal({ ...ok, a_key: "saved:old2", b_key: "saved:b1" }, [], [...templates, { id: "old2", archived: false }])).toBeNull());
  it("needs a real offer", () => expect(startTestRefusal({ ...ok, service_key: "custom" }, [], templates)).toBe("Pick the offer to test."));
  it("version B must be a saved template", () =>
    expect(startTestRefusal({ ...ok, b_key: "service:seo" }, [], templates)).toBe("Version B must be a saved template. Write it on this page first."));
  it("two different emails", () => expect(startTestRefusal({ ...ok, a_key: "saved:b1" }, [], templates)).toBe("Pick two different emails."));
  it("a saved template that doesn't exist or is archived", () => {
    expect(startTestRefusal({ ...ok, b_key: "saved:gone" }, [], templates)).toBe("That saved template can't be used (it was deleted or archived).");
    expect(startTestRefusal({ ...ok, b_key: "saved:old" }, [], templates)).toBe("That saved template can't be used (it was deleted or archived).");
  });
  it("a ready-made version A must be this offer's own email", () =>
    expect(startTestRefusal({ ...ok, a_key: "service:website_build" }, [], templates)).toBe("Version A's ready-made email is for a different offer."));
  it("one test per offer at a time", () =>
    expect(startTestRefusal(ok, [T], templates)).toBe("This offer already has a wording test running. End it first."));
});

describe("startingEmail (what Send email fills for an offer)", () => {
  const running = [{ id: "t1", serviceKey: "seo", next: "B" as const, aKey: "service:seo", bKey: "saved:b1" }];
  it("a running test: the version whose turn it is", () =>
    expect(startingEmail("seo", running, {})).toEqual({ key: "saved:b1", test: { id: "t1", variant: "B" } }));
  it("no test, but a saved template won the last one: that template", () =>
    expect(startingEmail("seo", [], { seo: "saved:w1" })).toEqual({ key: "saved:w1", test: null }));
  it("otherwise the offer's ready-made email", () => {
    expect(startingEmail("website_build", running, { seo: "saved:w1" })).toEqual({ key: "service:website_build", test: null });
    expect(startingEmail("custom", running, {})).toEqual({ key: "service:custom", test: null });
  });
});
