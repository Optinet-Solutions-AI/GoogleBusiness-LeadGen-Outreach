/**
 * suppression-country.test.ts — the do-not-contact gate refuses a lead outside its batch's country.
 *
 * Inputs:  lead objects (no DB: the wrong-country rule answers before any lookup)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }));
vi.mock("./db", () => ({ getDb: () => ({ from }) }));
vi.mock("./logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { isSuppressed } from "./suppression";

describe("isSuppressed — wrong country", () => {
  it("blocks every channel for a US shop in an Italy batch, without a DB lookup", async () => {
    const lead = { phone: "(706) 555-0100", address: "3 S Division St, Rome, GA 30165", country_code: "it" };
    for (const ch of ["email", "sms", "voice"] as const) expect(await isSuppressed(lead, ch)).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("lets a lead in its own country through to the normal checks", async () => {
    const lead = { phone: "+39 080 555 0100", address: "Via Roma 1, 70126 Bari BA, Italy", country_code: "it" };
    expect(await isSuppressed(lead, "email")).toBe(false);
  });
});
