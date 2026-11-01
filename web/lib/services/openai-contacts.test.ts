/**
 * openai-contacts.test.ts — reading OpenAI's contact answer: keep only backed, well-formed fields; cost estimate.
 *
 * Inputs:  Responses-API bodies shaped like real ones (message + web_search_call items)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({
  env: { OPENAI_API_KEY: "", OPENAI_CONTACT_MODEL: "gpt-5.4-mini", OPENAI_CONTACT_USD_PER_MTOK_IN: 0.75, OPENAI_CONTACT_USD_PER_MTOK_OUT: 4.5, OPENAI_CONTACT_USD_PER_SEARCH: 0.01 },
}));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("./headless-browser", () => ({ getBrowser: vi.fn(), buildProxyOptions: vi.fn() }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { contactPrompt, lookupCostUsd, parseContacts } from "./openai-contacts";

const body = (answer: unknown) => ({
  output: [
    { type: "web_search_call" },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] },
  ],
  usage: { input_tokens: 10_000, output_tokens: 500 },
});

describe("openai-contacts", () => {
  it("keeps a sourced answer", () => {
    const r = parseContacts(
      body({
        email: "Info@Deckor.com.mt", phone: "+356 2762 6262", contact_url: "https://deckor.com.mt/get-in-touch/",
        owner_name: "Jane Borg", owner_role: "Director", sources: ["https://deckor.com.mt/get-in-touch/"],
      }),
      "http://deckor.com.mt/",
      0.02,
    );
    expect(r).toMatchObject({ email: "info@deckor.com.mt", phone: "+356 2762 6262", contact_url: "https://deckor.com.mt/get-in-touch/", owner_name: "Jane Borg", owner_role: "Director" });
  });

  it("drops everything when no source page backs it", () => {
    const r = parseContacts(body({ email: "info@x.mt", phone: "+356 1234 5678", contact_url: null, owner_name: "A", owner_role: null, sources: [] }), null, 0);
    expect(r).toMatchObject({ email: null, phone: null, owner_name: null });
  });

  it("rejects junk and malformed emails and copes with an empty answer", () => {
    expect(parseContacts(body({ email: "asset-1@2x.svg", phone: null, contact_url: "not a url", owner_name: null, owner_role: null, sources: ["https://a.mt"] }), null, 0))
      .toMatchObject({ email: null, contact_url: null });
    expect(parseContacts({ output: [] }, null, 0).email).toBeNull();
  });

  it("estimates cost from tokens and searches", () => {
    expect(lookupCostUsd({ input_tokens: 10_000, output_tokens: 500 }, 2)).toBeCloseTo(0.0075 + 0.00225 + 0.02, 5);
  });

  it("asks for the site's own pages first and forbids guessing", () => {
    const p = contactPrompt({ business_name: "Deckor", website_url: "http://deckor.com.mt/", country_code: "mt" });
    expect(p).toContain("Website: http://deckor.com.mt/");
    expect(p).toContain("Never guess");
    expect(p).toContain("Country: MT");
  });
});
