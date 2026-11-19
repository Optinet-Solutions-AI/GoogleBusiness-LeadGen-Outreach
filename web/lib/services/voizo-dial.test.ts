/**
 * voizo-dial.test.ts — the body we POST to Voizo for one call: the chosen script only when one was picked.
 *
 * Inputs:  dial inputs
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env: { VOIZO_API_KEY: "", VOIZO_API_BASE: "https://voizo.test" } }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { dialBody } from "./voizo";

describe("dialBody", () => {
  it("sends the chosen Voizo script as campaignId", () => {
    expect(dialBody({ phone: "+15125550100", name: "Joe", clientRef: "L1", campaignId: "vz-rep" })).toEqual({
      phone: "+15125550100",
      name: "Joe",
      clientRef: "L1",
      campaignId: "vz-rep",
    });
  });
  it("leaves campaignId out when no agent was picked (Voizo's default script)", () => {
    expect(dialBody({ phone: "+15125550100", campaignId: null })).toEqual({ phone: "+15125550100" });
  });
});
