/**
 * plans.test.ts — CREATIVE_MAX_PER_PLAN is enforced when concepts are edited (mocked env + db, no network).
 *
 * Inputs:  a mocked env (cap 2) and a db that must not be reached for an over-long list
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { Concept } from "./types";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({ env: { CREATIVE_MAX_PER_PLAN: 2, OPENAI_IMAGE_USD_PER_IMAGE: 0.053 } }));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("db must not be reached");
  },
}));
vi.mock("@/lib/clients/profile", () => ({ NotFoundError: class extends Error {} }));

import { updatePlanConcepts } from "./plans";

const concept = (i: number): Concept => ({
  slot_date: `2026-12-0${i + 1}`,
  platforms: ["instagram"],
  template_key: "tip-quote",
  kind: "image",
  title: `c${i}`,
  angle: "a",
  product_id: null,
  claim_refs: [],
  cta_kind: "book",
  hashtags_seed: [],
});

describe("updatePlanConcepts", () => {
  it("rejects more concepts than CREATIVE_MAX_PER_PLAN before touching the db (Ruling 32)", async () => {
    const err = await updatePlanConcepts("c", "p", [concept(0), concept(1), concept(2)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues[0].message).toContain("at most 2 posts");
  });
});
