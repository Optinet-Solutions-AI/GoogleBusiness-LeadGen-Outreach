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

import { QUICK_CALL_PREFIX, quickCampaignName } from "./quick-call";

describe("quickCampaignName", () => {
  it("is one standing campaign per country", () => {
    expect(quickCampaignName("us")).toBe(`${QUICK_CALL_PREFIX} · US`);
    expect(quickCampaignName("nz")).toBe(`${QUICK_CALL_PREFIX} · NZ`);
    expect(quickCampaignName(null)).toBe(`${QUICK_CALL_PREFIX} · XX`);
  });
});
