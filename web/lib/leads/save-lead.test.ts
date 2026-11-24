/**
 * save-lead.test.ts — a lead save with the AI website check's columns still works before migration 069.
 *
 * Inputs:  a fake Supabase client
 * Outputs: vitest assertions on what was saved
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { updateLead } from "./save-lead";

function fakeDb(missing: boolean) {
  const saved: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          saved.push(patch);
          if (missing && "website_review" in patch) return { error: { code: "PGRST204", message: "Could not find the 'website_review' column" } };
          return { error: null };
        },
      }),
    }),
  };
  return { db, saved };
}

describe("updateLead", () => {
  it("069 applied: one save with everything", async () => {
    const { db, saved } = fakeDb(false);
    expect((await updateLead(db as never, "l1", { website_url: "https://a.com", website_review: null })).error).toBeNull();
    expect(saved).toEqual([{ website_url: "https://a.com", website_review: null }]);
  });
  it("069 missing: saves again without the website-check columns instead of failing", async () => {
    const { db, saved } = fakeDb(true);
    const r = await updateLead(db as never, "l1", { website_url: "https://a.com", website_review: null, website_reviewed_at: null });
    expect(r.error).toBeNull();
    expect(saved.at(-1)).toEqual({ website_url: "https://a.com" });
  });
});
