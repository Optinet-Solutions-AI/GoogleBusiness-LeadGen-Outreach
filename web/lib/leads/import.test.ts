import { describe, it, expect } from "vitest";
import { normalizePhone, validateLeadInput, dedupeKey, buildLeadRow } from "@/lib/leads/import";

describe("normalizePhone", () => {
  it("formats a 10-digit US number to E.164", () => {
    expect(normalizePhone("(512) 555-1234")).toBe("+15125551234");
  });
  it("keeps an existing +country number", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk / empty", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("validateLeadInput", () => {
  it("accepts a row with a valid phone", () => {
    const r = validateLeadInput({ business_name: "Joe's Plumbing", phone: "512-555-1234", website_url: "" }, "csv");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.phone).toBe("+15125551234");
      expect(r.lead.has_website).toBe(false);
      expect(r.lead.source).toBe("csv");
    }
  });
  it("rejects a row with no usable phone", () => {
    const r = validateLeadInput({ business_name: "No Phone Co", phone: "nope" }, "manual");
    expect(r.ok).toBe(false);
  });
  it("flags has_website when a website is present", () => {
    const r = validateLeadInput({ phone: "5125551234", website_url: "http://x.com" }, "csv");
    expect(r.ok && r.lead.has_website).toBe(true);
  });
});

describe("dedupeKey", () => {
  it("is the normalized phone", () => {
    expect(dedupeKey({ phone: "+15125551234" })).toBe("+15125551234");
  });
});

describe("buildLeadRow", () => {
  it("maps to a leads row; no-website import → call_segment no_website", () => {
    const lead = { business_name: "Joe's", phone: "+15125551234", city: "Austin", country_code: "us", website_url: null, has_website: false, source: "csv" as const };
    const row = buildLeadRow(lead, "batch-1");
    expect(row.batch_id).toBe("batch-1");
    expect(row.source).toBe("csv");
    expect(row.has_website).toBe(false);
    expect(row.call_segment).toBe("no_website");
    expect(row.stage).toBe("scraped");
  });
  it("import WITH a website leaves call_segment null (operator's campaign segment governs)", () => {
    const lead = { business_name: "Has Site", phone: "+15125551235", city: null, country_code: null, website_url: "http://x.com", has_website: true, source: "manual" as const };
    const row = buildLeadRow(lead, "batch-1");
    expect(row.call_segment).toBeNull();
  });
});
