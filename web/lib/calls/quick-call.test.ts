/**
 * quick-call.test.ts — the standing Quick calls campaign is named per country.
 *
 * Inputs:  country codes
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/campaigns/add-members", () => ({ addMembers: vi.fn() }));
vi.mock("@/lib/services/voizo", () => ({ isVoizoConfigured: () => true }));

import { QUICK_CALL_PREFIX, quickCampaignName, queueQuickCall } from "./quick-call";
import { getDb } from "@/lib/db";
import { addMembers } from "@/lib/campaigns/add-members";

type Res = { data?: unknown; error?: { message: string; code?: string } | null };
function chain(result: Res) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "not", "match"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (ok: (r: Res) => unknown) => Promise.resolve(result).then(ok);
  return c;
}
function fakeDb(lead: Record<string, unknown>, upsertError: Res["error"] = null) {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table === "leads") return chain({ data: lead, error: null });
      if (table === "call_campaigns") return { ...chain({ data: { id: "C1", status: "active" }, error: null }), update: () => chain({ error: null }) };
      return {
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: upsertError };
        },
        update: () => chain({ error: null }),
      };
    },
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return upserts;
}
const LEAD = { id: "L1", business_name: "Joe's Plumbing", phone: null, country_code: "us", lifecycle_stage: null, call_status: null, email: null, verification_status: null };

describe("queueQuickCall with a test number", () => {
  it("queues the call to the typed number only, fresh, even when the lead has no phone", async () => {
    const upserts = fakeDb(LEAD);
    const r = await queueQuickCall("L1", { testPhone: "+1 (512) 555-0123", greetingName: "Dana" });
    expect(r.queued).toBe(true);
    expect(r.message).toContain("+15125550123");
    expect(upserts).toEqual([
      { campaign_id: "C1", lead_id: "L1", status: "pending", call_attempts: 0, next_call_at: null, call_phone: "+15125550123", call_name: "Dana" },
    ]);
    expect(addMembers).not.toHaveBeenCalled();
  });

  it("refuses a number it can't read, and queues nothing", async () => {
    const upserts = fakeDb(LEAD);
    const r = await queueQuickCall("L1", { testPhone: "call me" });
    expect(r).toMatchObject({ queued: false });
    expect(r.message).toContain("country code");
    expect(upserts).toEqual([]);
  });

  it("keeps every other rule: a GDPR-country lead is still never called", async () => {
    const upserts = fakeDb({ ...LEAD, country_code: "mt" });
    const r = await queueQuickCall("L1", { testPhone: "+356 2123 4567" });
    expect(r).toMatchObject({ queued: false });
    expect(r.message).toContain("GDPR");
    expect(upserts).toEqual([]);
  });

  it("says database update 060 is needed when the column isn't there", async () => {
    fakeDb(LEAD, { message: 'column "call_phone" of relation "campaign_leads" does not exist', code: "42703" });
    const r = await queueQuickCall("L1", { testPhone: "+15125550123" });
    expect(r).toMatchObject({ queued: false });
    expect(r.message).toContain("060");
  });
});

describe("quickCampaignName", () => {
  it("is one standing campaign per country", () => {
    expect(quickCampaignName("us")).toBe(`${QUICK_CALL_PREFIX} · US`);
    expect(quickCampaignName("nz")).toBe(`${QUICK_CALL_PREFIX} · NZ`);
    expect(quickCampaignName(null)).toBe(`${QUICK_CALL_PREFIX} · XX`);
  });
});
