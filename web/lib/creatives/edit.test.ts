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

const state = vi.hoisted(() => ({ ai: {} as Record<string, unknown>, template: "offer" }));
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
    template_key: state.template,
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
    state.template = "offer";
    profile.reviews = undefined;
  });

  it("keeps a previously cited claim grounded when citations were stored", async () => {
    // the full cited phrase (a bare "same-day" citation no longer covers anything, Ruling 28)
    state.ai = { claims_used: [{ text: "same-day service", path: "claims.allowed[0]" }] };
    const r = await prepareEdit("c", "x", { copy: { instagram: { caption: "We offer same-day service. Stay cozy.", hashtags: [] } } });
    expect(r.grounding.ok).toBe(true);
    expect(r.claimsUsed).toHaveLength(1);
  });

  it("flags the claim when no citations were stored", async () => {
    const r = await prepareEdit("c", "x", { copy: { instagram: { caption: "We offer same-day service. Stay cozy.", hashtags: [] } } });
    expect(r.grounding.ok).toBe(false);
  });

  // Ruling 30: review posts are checked against reviews[n] (quote + author)
  const reviewEdit = (subhead: string) =>
    prepareEdit("c", "x", {
      inputs: { body: "on time and very friendly", subhead },
      copy: { instagram: { caption: "Thanks for the kind words.", hashtags: [] } },
    });
  it("blocks a review post with an invented author", async () => {
    state.template = "review";
    profile.reviews = [{ value: { body: "They were on time and very friendly", author: "Jane D." }, source: { kind: "google_maps" }, confirmed: true }];
    const bad = await reviewEdit("Jennifer K., verified Google reviewer");
    expect(bad.grounding.ok).toBe(false);
    expect(bad.grounding.issues.map((i) => i.reason)).toContain("review author does not match");
    expect((await reviewEdit("Jane D.")).grounding.ok).toBe(true);
  });
  it("blocks a review post when the brain has no reviews (review-like claims do not count)", async () => {
    state.template = "review";
    const r = await reviewEdit("Jane D.");
    expect(r.grounding.ok).toBe(false);
    expect(r.grounding.issues.map((i) => i.reason)).toContain("no review fact in the Brand Brain");
  });
});
