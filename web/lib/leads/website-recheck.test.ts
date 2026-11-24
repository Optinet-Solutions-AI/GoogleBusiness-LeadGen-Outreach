/**
 * website-recheck.test.ts — when "Check website again" is refused, and what a finished check changes on the lead.
 *
 * Inputs:  sample leads + reviews
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { recheckPatch, recheckRefusal, RECHECK_WAIT_MS } from "./website-recheck";
import type { WebsiteReview } from "./website-review";

const now = new Date("2026-11-25T12:00:00Z");
const lead = { website_url: "https://joes.com", signal_type: null, website_review: null };

describe("Check website again: when it's refused", () => {
  it("a normal lead with a website can be checked", () => {
    expect(recheckRefusal(lead, now)).toBeNull();
  });
  it("no website → nothing to check", () => {
    expect(recheckRefusal({ ...lead, website_url: null }, now)).toMatch(/no website/i);
  });
  it("closing, exhibitor and review-site leads are never pitched a website, so no check", () => {
    expect(recheckRefusal({ ...lead, signal_type: "exhibitor" }, now)).toMatch(/never pitched a website/i);
  });
  it("a check still running (under 3 minutes) isn't started twice; an older stuck one can be restarted", () => {
    const pending = (ms: number) => ({ ...lead, website_review: { pending_at: new Date(now.getTime() - ms).toISOString() } });
    expect(recheckRefusal(pending(60_000), now)).toMatch(/already checking/i);
    expect(recheckRefusal(pending(RECHECK_WAIT_MS + 1000), now)).toBeNull();
  });
});

describe("what a finished check changes", () => {
  const review = {
    verdict: "good_website",
    score: 82,
    reasons: ["Modern design"],
    checked_at: "2026-11-25T12:01:00Z",
  } as unknown as WebsiteReview;
  it("sets the verdict fields, the pitch (segment + offers), and hands routing back from any old manual choice", () => {
    const p = recheckPatch(review);
    expect(p).toMatchObject({
      has_website: true,
      needs_improvement: false,
      website_score: 82,
      website_issues: ["Modern design"],
      call_segment: "has_website",
      offer_locked: false,
      website_review: review,
      website_reviewed_at: "2026-11-25T12:01:00Z",
    });
    expect(p).toMatchObject({ primary_offer: null, secondary_offer: "voice_agent" }); // has_website: AI services
    expect(recheckPatch({ ...review, verdict: "old_website" }).primary_offer).toBe("improve_website");
  });
  it("an old site is pitched a redesign; no real site a new website", () => {
    expect(recheckPatch({ ...review, verdict: "old_website" }).call_segment).toBe("old_website");
    expect(recheckPatch({ ...review, verdict: "no_website" }).call_segment).toBe("no_website");
  });
});
