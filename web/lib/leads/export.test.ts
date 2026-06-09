import { describe, it, expect } from "vitest";
import { leadsToCsv, type ExportLead } from "./export";

const base: ExportLead = {
  business_name: "Acme Plumbing",
  phone: "+15551234567",
  primary_offer: "build_website",
  category: "plumber",
  address: "1 Main St",
  country_code: "us",
  website_url: null,
  has_website: false,
  email: null,
  verification_status: "valid",
  rating: 4.5,
  review_count: 12,
  stage: "scraped",
};

describe("leadsToCsv", () => {
  it("emits the header row even with no leads", () => {
    const csv = leadsToCsv([]);
    expect(csv.split("\r\n")[0]).toBe(
      "business_name,phone,offer,category,address,country_code,website_url,has_website,email,verification_status,rating,review_count,stage",
    );
  });

  it("escapes commas, quotes and newlines (RFC-4180)", () => {
    const csv = leadsToCsv([{ ...base, business_name: 'Joe, "The" Plumber', address: "Line1\nLine2" }]);
    expect(csv).toContain('"Joe, ""The"" Plumber"');
    expect(csv).toContain('"Line1\nLine2"');
  });

  it("renders null cells as empty strings, not the literal 'null'", () => {
    const csv = leadsToCsv([{ ...base, email: null, website_url: null }]);
    expect(csv).not.toContain("null");
  });

  it("maps primary_offer to a plain-English offer; null → 'Discovery (your call)'", () => {
    const offerCell = (l: Partial<ExportLead>) =>
      leadsToCsv([{ ...base, ...l }]).split("\r\n")[1].split(",")[2];
    expect(offerCell({ primary_offer: "build_website" })).toBe("Build website");
    expect(offerCell({ primary_offer: "improve_website" })).toBe("Improve website");
    expect(offerCell({ primary_offer: null })).toBe("Discovery (your call)");
  });
});
