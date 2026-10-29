/**
 * edit.test.ts — prepareEdit keeps previously cited claims grounded across an edit (fixtures only, no network).
 *
 * Inputs:  mocked creative / profile / assets
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROFILE } from "@/lib/clients/types";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

const state = vi.hoisted(() => ({ ai: {} as Record<string, unknown> }));
const profile = structuredClone(EMPTY_PROFILE);
profile.claims.allowed = [{ value: "Same-day service", source: { kind: "operator" }, confirmed: true }];

vi.mock("@/lib/clients/assets", () => ({ listAssets: async () => [] }));
vi.mock("@/lib/clients/profile", () => ({
  NotFoundError: class extends Error {},
  getCurrentProfile: async () => ({ data: profile }),
  snapshotProducts: async () => [],
}));
vi.mock("./creatives", () => ({
  getCreative: async () => ({
    product_id: null,
    template_key: "offer",
    versions: [
      {
        inputs: { headline: "Hi", subhead: "There", cta_text: "Call", cta_kind: "call" },
        copy: { instagram: { caption: "We offer same-day service.", hashtags: [] } },
        ai: state.ai,
      },
    ],
  }),
}));

import { prepareEdit } from "./edit";

describe("prepareEdit", () => {
  beforeEach(() => {
    state.ai = {};
  });

  it("keeps a previously cited claim grounded when citations were stored", async () => {
    state.ai = { claims_used: [{ text: "same-day", path: "claims.allowed[0]" }] };
    const r = await prepareEdit("c", "x", { copy: { instagram: { caption: "We offer same-day service. Stay cozy.", hashtags: [] } } });
    expect(r.grounding.ok).toBe(true);
    expect(r.claimsUsed).toHaveLength(1);
  });

  it("flags the claim when no citations were stored", async () => {
    const r = await prepareEdit("c", "x", { copy: { instagram: { caption: "We offer same-day service. Stay cozy.", hashtags: [] } } });
    expect(r.grounding.ok).toBe(false);
  });
});
