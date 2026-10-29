/**
 * company-website.test.ts — domain guessing, page matching and phone extraction.
 *
 * Inputs:  fixed strings
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { extractUsPhone, guessDomains, nameTokens, pageMatchesCompany } from "./company-website";

describe("company-website", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(nameTokens("Expedia, Inc.")).toEqual(["expedia"]);
    expect(nameTokens("Joe's Pizza & Grill LLC")).toEqual(["joes", "pizza", "and", "grill"]);
  });

  it("guesses joined, hyphenated and first-word domains", () => {
    expect(guessDomains("Expedia, Inc.")).toEqual(["expedia.com"]);
    expect(guessDomains("Lombard Street Facility")).toEqual(["lombardstreetfacility.com", "lombard-street-facility.com", "lombard.com"]);
    expect(guessDomains("Inc.")).toEqual([]);
  });

  it("matches a page that names the company and rejects parked pages", () => {
    expect(pageMatchesCompany("<title>Expedia Travel</title>", "Expedia, Inc.")).toBe(true);
    expect(pageMatchesCompany("<h1>Welcome</h1>", "Expedia, Inc.")).toBe(false);
    expect(pageMatchesCompany("expedia.com — this domain is for sale", "Expedia, Inc.")).toBe(false);
  });

  it("extracts a US phone from tel links or text", () => {
    expect(extractUsPhone('<a href="tel:+1-602-324-8502">Call</a>')).toBe("(602) 324-8502");
    expect(extractUsPhone("<p>Call us at (512) 555-0199 today</p>")).toBe("(512) 555-0199");
    expect(extractUsPhone("<p>512.555.0199</p>")).toBe("(512) 555-0199");
    expect(extractUsPhone("<p>Order #1234567890123</p>")).toBeNull();
    expect(extractUsPhone("<p>no phone here</p>")).toBeNull();
  });
});
