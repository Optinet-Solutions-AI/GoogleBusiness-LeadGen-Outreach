/**
 * country-coverage.test.ts — every country offered in the dropdowns must resolve
 * to a real timezone (campaign scheduling) and a language (translation).
 * Guards against adding a COUNTRIES entry without a tz/lang mapping.
 */
import { describe, it, expect } from "vitest";
import { COUNTRIES } from "@/lib/data/cities";
import { campaignTimezone } from "@/lib/call-hours";
import { resolveLanguageCode } from "@/lib/services/gemini";

describe("country coverage", () => {
  it("every COUNTRIES code maps to a non-UTC timezone", () => {
    const missing = COUNTRIES.filter((c) => campaignTimezone(c.code) === "UTC").map((c) => c.code);
    expect(missing).toEqual([]);
  });

  it("every COUNTRIES code resolves to a language code", () => {
    for (const c of COUNTRIES) {
      const lang = resolveLanguageCode(null, c.code);
      expect(typeof lang).toBe("string");
      expect(lang.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("a known country resolves to its expected tz + language", () => {
    expect(campaignTimezone("au")).toBe("Australia/Sydney");
    expect(campaignTimezone("br")).toBe("America/Sao_Paulo");
    expect(resolveLanguageCode(null, "br")).toBe("pt");
    expect(resolveLanguageCode(null, "mx")).toBe("es");
  });
});
