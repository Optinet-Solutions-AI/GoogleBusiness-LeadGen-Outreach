import { describe, expect, it } from "vitest";
import { costPerReply, type CprBatch, type CprEvent, type CprLead } from "./cost-per-reply";

const B = (id: string, niche: string, est: number | null, created_at = "2026-11-20T00:00:00Z"): CprBatch => ({ id, niche, city: "Austin, TX", created_at, estimated_cost_usd: est });
const L = (id: string, batch_id: string, category: string | null = "Plumber", offer = "Build a website"): CprLead => ({ id, batch_id, category, offer });
const E = (lead_id: string, kind: string, at = "2026-11-21T00:00:00Z", noop = false): CprEvent => ({ lead_id, kind, at, noop });
const base = { formUsd: new Map<string, number>(), groupBy: "niche" as const, since: null, periods: [] };

describe("costPerReply", () => {
  it("splits the batch estimate over all its leads and divides by replies", () => {
    const rows = costPerReply({
      ...base,
      batches: [B("b1", "plumbers", 10)],
      leads: [L("a", "b1"), L("b", "b1"), L("c", "b1"), L("d", "b1")],
      events: [E("a", "email_sent"), E("b", "email_sent"), E("a", "email_reply"), E("a", "email_reply")],
    });
    expect(rows).toEqual([{ key: "plumbers", found: 4, contacted: 2, emails: 2, replies: 1, rate: 0.5, interested_calls: 0, spend: 10, cost_per_reply: 10 }]);
  });

  it("no replies or no cost never divides by zero", () => {
    const [r] = costPerReply({ ...base, batches: [B("b1", "x", null)], leads: [L("a", "b1")], events: [E("a", "email_sent")] });
    expect(r.spend).toBe(0);
    expect(r.cost_per_reply).toBeNull();
    expect(costPerReply({ ...base, batches: [B("b2", "y", 5)], leads: [], events: [] })).toEqual([]);
    const [n] = costPerReply({ ...base, batches: [B("b3", "z", 5)], leads: [L("q", "b3")], events: [] });
    expect([n.rate, n.cost_per_reply]).toEqual([null, null]);
  });

  it("ignores activity inside a test period and sends that never went out", () => {
    const [r] = costPerReply({
      ...base,
      periods: [{ from: "2026-11-26T00:00:00Z", to: "2026-12-10T00:00:00Z" }],
      batches: [B("b1", "x", 2)],
      leads: [L("a", "b1"), L("b", "b1")],
      events: [E("a", "email_sent", "2026-11-27T00:00:00Z"), E("a", "email_reply", "2026-11-28T00:00:00Z"), E("b", "email_sent", "2026-11-21T00:00:00Z", true)],
    });
    expect([r.contacted, r.replies, r.emails]).toEqual([0, 0, 0]);
  });

  it("'Any' niche batches group by the lead's category; offer and city grouping; forms add real cost", () => {
    const batches = [B("b1", "Any trades", 4)];
    const leads = [L("a", "b1", "Plumber"), L("b", "b1", "Electrician", "Redesign"), L("c", "b1", null)];
    expect(costPerReply({ ...base, batches, leads, events: [] }).map((r) => r.key).sort()).toEqual(["Electrician", "Plumber", "Unknown"]);
    expect(costPerReply({ ...base, groupBy: "offer", batches, leads, events: [] }).map((r) => r.key).sort()).toEqual(["Build a website", "Redesign"]);
    const [c] = costPerReply({ ...base, groupBy: "city", batches, leads, events: [E("a", "contact_form_sent"), E("a", "call_qualified")], formUsd: new Map([["a", 0.25]]) });
    expect(c).toMatchObject({ key: "Austin, TX", contacted: 1, interested_calls: 1, spend: 4.25 });
  });

  it("since filters by batch creation date; rows sorted by spend", () => {
    const rows = costPerReply({
      ...base,
      since: "2026-11-25T00:00:00Z",
      batches: [B("old", "x", 1, "2026-11-01T00:00:00Z"), B("new", "y", 1, "2026-11-26T00:00:00Z"), B("new2", "w", 3, "2026-11-27T00:00:00Z")],
      leads: [L("a", "old"), L("b", "new"), L("c", "new2")],
      events: [],
    });
    expect(rows.map((r) => r.key)).toEqual(["w", "y"]);
  });

  it("a call placed counts as contacted, not as an email", () => {
    const [r] = costPerReply({ ...base, batches: [B("b1", "x", 1)], leads: [L("a", "b1")], events: [E("a", "call_placed")] });
    expect([r.contacted, r.emails]).toEqual([1, 0]);
  });
});
