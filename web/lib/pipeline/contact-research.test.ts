/**
 * contact-research.test.ts — AI research runs first, the own-site crawl fills gaps and wins on email, and an
 * unavailable OpenAI turns into a tally (for the batch notice) instead of silent thinner results.
 *
 * Inputs:  fake AI / crawl lookups
 * Outputs: vitest assertions on the mutated row and the AiRun tally
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({ env: { OPENAI_API_KEY: "" } }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { researchContacts, type ContactResearchDeps } from "./contact-research";
import { newAiRun } from "./ai-notices";
import { OpenAiUnavailableError } from "../services/openai-health";

const aiAnswer = {
  email: "info@directory-listed.com",
  phone: "+356 2701 8705",
  contact_url: null,
  owner_name: "Robert Ellul",
  owner_role: "Owner",
  sources: ["https://www.yellow.com.mt/x"],
  usd: 0.03,
};

function deps(over: Partial<ContactResearchDeps> = {}) {
  const order: string[] = [];
  const d: ContactResearchDeps = {
    ai: vi.fn(async () => {
      order.push("ai");
      return aiAnswer;
    }),
    crawl: vi.fn(async () => {
      order.push("crawl");
      return { email: "hello@ownsite.com", phone: null, contact_url: "https://ownsite.com/contact" };
    }),
    ...over,
  };
  return { d, order };
}

const opts = { aiEligible: true, ownSite: "https://ownsite.com", countryCode: "mt" };

describe("researchContacts", () => {
  it("asks AI first, then crawls; the own-site email wins and both sources are kept", async () => {
    const { d, order } = deps();
    const row: Record<string, unknown> = { business_name: "Balloon Man" };
    const ai = newAiRun(10);
    await researchContacts(row, opts, ai, d);
    expect(order).toEqual(["ai", "crawl"]);
    expect(row.email).toBe("hello@ownsite.com");
    expect(row.phone).toBe("+356 2701 8705");
    expect(row.contact_owner_name).toBe("Robert Ellul");
    expect(row.contact_sources).toEqual(["https://ownsite.com/contact", "https://www.yellow.com.mt/x"]);
    expect(ai).toMatchObject({ used: 1, left: 9, usd: 0.03 });
  });

  it("keeps the AI email when the business has no website", async () => {
    const { d } = deps();
    const row: Record<string, unknown> = { business_name: "Balloon Man" };
    await researchContacts(row, { ...opts, ownSite: null }, newAiRun(10), d);
    expect(d.crawl).not.toHaveBeenCalled();
    expect(row.email).toBe("info@directory-listed.com");
  });

  it("never overwrites what the scraper gave", async () => {
    const { d } = deps();
    const row: Record<string, unknown> = { business_name: "X", email: "google@x.com", phone: "+1 555" };
    await researchContacts(row, opts, newAiRun(10), d);
    expect(row.email).toBe("google@x.com");
    expect(row.phone).toBe("+1 555");
  });

  it("skips AI when OpenAI was unavailable from the start, but still crawls", async () => {
    const { d } = deps();
    const ai = { ...newAiRun(10), unavailable: "key_invalid" as const };
    const row: Record<string, unknown> = { business_name: "X" };
    await researchContacts(row, opts, ai, d);
    expect(d.ai).not.toHaveBeenCalled();
    expect(row.email).toBe("hello@ownsite.com");
  });

  it("stops AI for the rest of the batch when the key is refused mid-run", async () => {
    const { d } = deps({ ai: vi.fn(async () => { throw new OpenAiUnavailableError("no_credit", "x"); }) });
    const ai = newAiRun(10);
    await researchContacts({ business_name: "A" }, opts, ai, d);
    await researchContacts({ business_name: "B" }, opts, ai, d);
    expect(ai.stoppedAt).toBe("no_credit");
    expect(d.ai).toHaveBeenCalledTimes(1);
    expect(d.crawl).toHaveBeenCalledTimes(2);
  });

  it("counts leads past the per-batch limit", async () => {
    const { d } = deps();
    const ai = newAiRun(1);
    await researchContacts({ business_name: "A" }, opts, ai, d);
    await researchContacts({ business_name: "B" }, opts, ai, d);
    expect(ai.used).toBe(1);
    expect(ai.skippedByCap).toBe(1);
  });

  it("does no AI research for liquidation leads", async () => {
    const { d } = deps();
    await researchContacts({ business_name: "A" }, { ...opts, aiEligible: false }, newAiRun(10), d);
    expect(d.ai).not.toHaveBeenCalled();
  });
});
