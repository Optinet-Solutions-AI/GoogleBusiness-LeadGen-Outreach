import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/services/openai-brain", () => ({ brainJson: vi.fn(), BrainError: class extends Error {} }));

import { scoreFields, scoreLead } from "./lead-score-run";
import { SCORE_SCHEMA, type ScoreLead } from "./lead-score";

const LEAD: ScoreLead = {
  id: "L1", business_name: "Joe's Plumbing", category: "Plumber", address: "Austin, TX", country_code: "us", rating: 4.8, review_count: 120,
  email: "joe@joes.com", verification_status: "valid", phone: "+1 512 555 0100", contact_page_url: null, contact_owner_name: null,
  website_url: null, website_review: null, ai_profile: null, signal_type: null, signal_meta: null,
  call_segment: null, has_website: false, website_kind: null, needs_improvement: null, primary_offer: null,
};

describe("scoreLead", () => {
  it("asks with the score model and returns the parsed score", async () => {
    const ask = vi.fn().mockResolvedValue({ data: { score: 74, reasons: ["No website", "Good reviews"], holding_back: "No email" }, usd: 0.003 });
    const s = await scoreLead(LEAD, { ask, now: () => new Date("2026-11-27T10:00:00Z") });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ name: "lead_score", model: "gpt-5.4-mini", schema: SCORE_SCHEMA }));
    expect(ask.mock.calls[0][0].input).not.toContain(LEAD.email);
    expect(ask.mock.calls[0][0].input).not.toContain("555");
    expect(s).toMatchObject({ score: 74, band: "hot", usd: 0.003, scored_at: "2026-11-27T10:00:00.000Z" });
  });

  it("returns null on an unusable answer", async () => {
    const ask = vi.fn().mockResolvedValue({ data: { score: "?", reasons: [], holding_back: "" }, usd: 0.003 });
    expect(await scoreLead(LEAD, { ask })).toBeNull();
  });
});

describe("scoreFields", () => {
  it("puts the number in its own sortable column", () => {
    const s = { score: 55, band: "warm" as const, reasons: ["a"], holding_back: "b", model: "m", usd: 0, scored_at: "t" };
    expect(scoreFields(s)).toEqual({ lead_score: 55, lead_score_detail: s, lead_scored_at: "t" });
  });
});
