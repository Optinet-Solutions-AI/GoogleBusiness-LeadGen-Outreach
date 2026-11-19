/**
 * voice-agents.test.ts — the Voizo scripts the operator can pick per AI call: validity, the default, the chosen id.
 *
 * Inputs:  sample agents
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no db in tests"); } }));

import { AgentInputSchema, defaultAgent, defaultsToClear, resolveAgentCampaign } from "./voice-agents";

const a = (id: string, extra: Partial<{ is_default: boolean; archived: boolean; voizo_campaign_id: string }> = {}) => ({
  id,
  name: `Agent ${id}`,
  voizo_campaign_id: `vz-${id}`,
  script_builder_url: null,
  is_default: false,
  archived: false,
  ...extra,
});

describe("AgentInputSchema", () => {
  it("needs a name and the Voizo script id; the Script Builder link must be a web address", () => {
    expect(AgentInputSchema.parse({ name: "Reputation", voizo_campaign_id: "abc-123" })).toMatchObject({ script_builder_url: null, is_default: false });
    expect(() => AgentInputSchema.parse({ name: "", voizo_campaign_id: "x" })).toThrow();
    expect(() => AgentInputSchema.parse({ name: "x", voizo_campaign_id: "x", script_builder_url: "not a link" })).toThrow();
  });
});

describe("defaultAgent", () => {
  it("is the active agent marked default, else the first active one, else none", () => {
    expect(defaultAgent([a("1"), a("2", { is_default: true })])?.id).toBe("2");
    expect(defaultAgent([a("1", { archived: true }), a("2")])?.id).toBe("2");
    expect(defaultAgent([a("1", { is_default: true, archived: true })])).toBeNull();
    expect(defaultAgent([])).toBeNull();
  });
});

describe("defaultsToClear", () => {
  it("keeps only one default: saving a new default un-defaults the others", () => {
    expect(defaultsToClear([a("1", { is_default: true }), a("2"), a("3", { is_default: true })], "2")).toEqual(["1", "3"]);
    expect(defaultsToClear([a("1")], "1")).toEqual([]);
  });
});

describe("resolveAgentCampaign", () => {
  it("gives the Voizo script id of the chosen active agent; none chosen or unknown = Voizo's default (null)", () => {
    const list = [a("1"), a("2", { archived: true })];
    expect(resolveAgentCampaign(list, "1")).toBe("vz-1");
    expect(resolveAgentCampaign(list, "2")).toBeNull();
    expect(resolveAgentCampaign(list, null)).toBeNull();
    expect(resolveAgentCampaign(list, "nope")).toBeNull();
  });
});
