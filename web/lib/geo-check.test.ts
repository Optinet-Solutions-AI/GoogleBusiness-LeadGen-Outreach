/**
 * geo-check.test.ts — country from an address, and the wrong-country lead check.
 *
 * Inputs:  real address shapes from Apify leads (Italy, US, Spain, Malta)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { addressCountry, isWrongCountryLead } from "./geo-check";

describe("addressCountry", () => {
  it("reads the trailing country name, English or local", () => {
    expect(addressCountry("Via Enrico Nannei, 12, 70126 Bari BA, Italy")).toBe("it");
    expect(addressCountry("Calle Mayor 3, 30001 Murcia, España")).toBe("es");
    expect(addressCountry("Triq il-Kbira, Mosta, Malta")).toBe("mt");
  });

  it("recognises a US street address without a country name", () => {
    expect(addressCountry("3 S Division St, Rome, GA 30165")).toBe("us");
    expect(addressCountry("10931 Day Rd, Houston, TX 77043-1234")).toBe("us");
  });

  it("returns null when it can't tell", () => {
    expect(addressCountry("Main Street")).toBeNull();
    expect(addressCountry(null)).toBeNull();
  });
});

describe("isWrongCountryLead", () => {
  it("flags a US shop in an Italy batch and keeps the Italian one", () => {
    expect(isWrongCountryLead({ address: "3 S Division St, Rome, GA 30165", country_code: "it" })).toBe(true);
    expect(isWrongCountryLead({ address: "Via Roma 1, 00100 Roma RM, Italy", country_code: "it" })).toBe(false);
  });

  it("never blocks on an unknown address or country", () => {
    expect(isWrongCountryLead({ address: "Main Street", country_code: "it" })).toBe(false);
    expect(isWrongCountryLead({ address: "3 S Division St, Rome, GA 30165", country_code: null })).toBe(false);
    expect(isWrongCountryLead({ address: "3 S Division St, Rome, GA 30165", country_code: "us" })).toBe(false);
  });
});
