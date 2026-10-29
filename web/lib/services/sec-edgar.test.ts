/**
 * sec-edgar.test.ts — EDGAR daily-index and filing-header parsing, signal selection.
 *
 * Inputs:  trimmed copies of real EDGAR text formats
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { parseFormIndex, parseHeader, signalFor, toNormalizedLead } from "./sec-edgar";

const IDX = `Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
8-K              22nd Century Group, Inc.                                      1347858     20261028    edgar/data/1347858/0001493152-26-048795.txt
8-K/A            Other Corp                                                    1111        20261028    edgar/data/1111/0001-26-1.txt
10-Q             Third Co                                                      2222        20261028    edgar/data/2222/0002-26-2.txt
`;

const HEAD = `<SEC-HEADER>
ITEM INFORMATION:		Bankruptcy or Receivership
ITEM INFORMATION:		Financial Statements and Exhibits
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			ACME RETAIL HOLDINGS, INC.
	BUSINESS ADDRESS:
		STREET 1:		100 MAIN STREET
		CITY:			DALLAS
		STATE:			TX
		ZIP:			75201
		BUSINESS PHONE:		214-555-0100
	MAIL ADDRESS:
		STREET 1:		PO BOX 1
		CITY:			AUSTIN
		STATE:			TX
</SEC-HEADER>`;

describe("sec-edgar", () => {
  it("keeps only plain 8-K rows from the daily index", () => {
    const rows = parseFormIndex(IDX);
    expect(rows).toEqual([{ company: "22nd Century Group, Inc.", cik: "1347858", filed: "2026-10-28", path: "edgar/data/1347858/0001493152-26-048795.txt" }]);
  });

  it("reads items, name and the BUSINESS (not mail) address", () => {
    const h = parseHeader(HEAD);
    expect(h.items).toEqual(["Bankruptcy or Receivership", "Financial Statements and Exhibits"]);
    expect(h).toMatchObject({ name: "ACME RETAIL HOLDINGS, INC.", city: "DALLAS", state: "TX", zip: "75201", phone: "214-555-0100" });
  });

  it("picks bankruptcy always and closures only when asked", () => {
    expect(signalFor(["Bankruptcy or Receivership"], "bankruptcy")).toBe("bankruptcy");
    expect(signalFor(["Costs Associated with Exit or Disposal Activities"], "bankruptcy")).toBeNull();
    expect(signalFor(["Costs Associated with Exit or Disposal Activities"], "bankruptcy_closures")).toBe("closure");
    expect(signalFor(["Entry into a Material Definitive Agreement"], "bankruptcy_closures")).toBeNull();
  });

  it("maps a filing to a lead with a stable sec: id", () => {
    const row = parseFormIndex(IDX)[0];
    const lead = toNormalizedLead(row, parseHeader(HEAD), "bankruptcy");
    expect(lead).toMatchObject({
      business_name: "ACME RETAIL HOLDINGS, INC.",
      phone: "(214) 555-0100",
      address: "100 Main Street, Dallas, TX 75201",
      place_id: "sec:0001493152-26-048795",
      business_status: "OPERATIONAL",
    });
    expect(lead.signal).toMatchObject({ type: "bankruptcy", date: "2026-10-28" });
  });
});
