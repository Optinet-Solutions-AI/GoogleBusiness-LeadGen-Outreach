import { describe, expect, it } from "vitest";
import { bandOf, byScoreDesc, factsFromLead, parseScore, scoreInput, scoreWait, type ScoreLead } from "./lead-score";

const LEAD: ScoreLead = {
  id: "L1", business_name: "A", category: "Plumber", address: "1 Main St, Austin, TX", country_code: "us", rating: 4.6, review_count: 30,
  email: "joe@joes.com", verification_status: "valid", phone: "+1 512 555 0100", contact_page_url: null, contact_owner_name: "Joe",
  website_url: "https://joes.com", website_review: null, ai_profile: { summary: "Family business", emails: ["joe@joes.com"], email_scope: { "joe@joes.com": "own" } },
  signal_type: null, signal_meta: null, call_segment: "has_website", has_website: true, website_kind: null, needs_improvement: false, primary_offer: null,
};
const BASE: ScoreLead = {
  id: "L", business_name: "B", category: null, address: null, country_code: null, rating: null, review_count: null, phone: null,
  email: null, verification_status: null, contact_page_url: null, contact_owner_name: null, website_url: null, website_review: null, ai_profile: null,
  signal_type: null, signal_meta: null, call_segment: null, has_website: false, website_kind: null, needs_improvement: null, primary_offer: null,
};

describe("bandOf", () => {
  it("70+ hot, 40–69 warm, under 40 cold", () => {
    expect([bandOf(100), bandOf(70), bandOf(69), bandOf(40), bandOf(39), bandOf(0)]).toEqual(["hot", "hot", "warm", "warm", "cold", "cold"]);
  });
});

describe("parseScore", () => {
  const meta = { model: "m", usd: 0.004, scored_at: "2026-11-27T10:00:00Z" };
  it("keeps a good answer, rounds and adds the band", () => {
    expect(parseScore({ score: 82.4, reasons: ["No website", "4.8★ from 120 reviews"], holding_back: "No email found" }, meta)).toEqual({
      score: 82, band: "hot", reasons: ["No website", "4.8★ from 120 reviews"], holding_back: "No email found", ...meta,
    });
  });
  it("clamps to 0–100 and keeps at most 3 non-empty reasons", () => {
    const s = parseScore({ score: 140, reasons: ["a", "", "b", "c", "d"], holding_back: "" }, meta)!;
    expect(s.score).toBe(100);
    expect(s.reasons).toEqual(["a", "b", "c"]);
  });
  it("rejects junk", () => {
    expect(parseScore(null, meta)).toBeNull();
    expect(parseScore({ score: "high", reasons: [], holding_back: "" }, meta)).toBeNull();
    expect(parseScore({ score: NaN, reasons: ["a"], holding_back: "" }, meta)).toBeNull();
    expect(parseScore({ score: 50, reasons: [], holding_back: "x" }, meta)).toBeNull(); // no reason = not evidence-based
  });
});

describe("scoreInput", () => {
  it("never contains an email address or phone number, says unknown facts plainly", () => {
    const text = scoreInput({
      business_name: "Joe's Plumbing", category: null, place: null, rating: null, review_count: null, segment: "no_website",
      offer_label: "Build a website", website: "not checked", research: null, signal: null, email: "none", has_phone: true, has_contact_page: false, owner_known: false,
    });
    expect(text).toContain("Joe's Plumbing");
    expect(text).toMatch(/Google rating: unknown/);
    expect(text).toMatch(/Offer we would pitch: Build a website/);
    expect(text).not.toMatch(/@|\+?\d[\d\s-]{7,}/);
  });
  it("the whole lead goes in without its email or phone", () => {
    const text = scoreInput(factsFromLead(LEAD));
    expect(text).not.toContain("joe@joes.com");
    expect(text).not.toContain("555");
  });
});

describe("factsFromLead", () => {
  it("turns contact data into yes/no facts only", () => {
    const f = factsFromLead(LEAD);
    expect(f.email).toBe("own_verified");
    expect(f.has_phone).toBe(true);
    expect(f.owner_known).toBe(true);
    expect(JSON.stringify(f)).not.toContain("joe@joes.com");
    expect(JSON.stringify(f)).not.toContain("555");
  });
  it("head-office inbox and bad address are told apart", () => {
    expect(factsFromLead({ ...BASE, email: "info@hq.com", verification_status: "likely", ai_profile: { emails: ["info@hq.com"], email_scope: { "info@hq.com": "head_office" } } }).email).toBe("head_office");
    expect(factsFromLead({ ...BASE, email: "x@y.com", verification_status: "invalid" }).email).toBe("bad");
    expect(factsFromLead({ ...BASE, email: "x@y.com", verification_status: null }).email).toBe("own_unchecked");
    expect(factsFromLead(BASE).email).toBe("none");
  });
});

describe("scoreWait + byScoreDesc", () => {
  it("2-minute cooldown", () => {
    const now = new Date("2026-11-27T10:02:00Z");
    expect(scoreWait("2026-11-27T10:01:00Z", now)).toBe(60);
    expect(scoreWait("2026-11-27T09:59:00Z", now)).toBe(0);
    expect(scoreWait(null, now)).toBe(0);
  });
  it("high scores first, unscored last", () => {
    const rows: { lead_score?: number | null }[] = [{ lead_score: null }, { lead_score: 40 }, { lead_score: 90 }, {}];
    expect(rows.sort(byScoreDesc).map((r) => r.lead_score ?? null)).toEqual([90, 40, null, null]);
  });
});
