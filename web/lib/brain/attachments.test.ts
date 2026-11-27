import { describe, expect, it } from "vitest";
import { attachmentsLine, countryCodeOf, importLeadRow, siteKey, checkFiles, clipBrief, fileKind, filterKnown, importEstimate, parseCsv, rowsFromTable, websiteKindOf, type ImportRow } from "./attachments";

const EXCEL_CSV = "﻿Name;Website;Email\r\n\"Joe's, Plumbing\";joes.com;JOE@JOES.COM\r\n;x.com;\r\n";

describe("parseCsv", () => {
  it("reads an Excel export: BOM, semicolons, a quoted comma, CRLF", () => {
    expect(parseCsv(EXCEL_CSV)).toEqual([
      ["Name", "Website", "Email"],
      ["Joe's, Plumbing", "joes.com", "JOE@JOES.COM"],
      ["", "x.com", ""],
    ]);
  });
  it("commas, escaped quotes, a newline inside quotes, empty lines dropped", () => {
    expect(parseCsv('a,b\n"say ""hi""","line\nbreak"\n\n')).toEqual([
      ["a", "b"],
      ['say "hi"', "line\nbreak"],
    ]);
  });
});

describe("rowsFromTable", () => {
  it("maps the columns, cleans the values and skips rows with no name", () => {
    const r = rowsFromTable(parseCsv(EXCEL_CSV));
    expect(r).toEqual({
      ok: true,
      rows: [{ business_name: "Joe's, Plumbing", website_url: "https://joes.com", email: "joe@joes.com", phone: null, address: null, city: null, category: null, country_code: null }],
      skipped: [{ reason: "no business name", count: 1 }],
    });
  });
  it("needs a business name column", () => {
    expect(rowsFromTable([["Website", "Email"], ["x.com", "a@x.com"]])).toEqual({ ok: false, message: "I need a column with the business name" });
  });
  it("keeps 1,000 rows at most and one of each duplicate", () => {
    const table = [["Company", "E-mail", "Phone", "Country"], ...Array.from({ length: 1005 }, (_, i) => [`Biz ${i}`, `b${i}@x.com`, "", "US"])];
    const r = rowsFromTable(table);
    if (!r.ok) throw new Error("expected ok");
    expect(r.rows).toHaveLength(1000);
    expect(r.rows[0].country_code).toBe("us");
    expect(r.skipped).toContainEqual({ reason: "over the 1,000 row limit", count: 5 });
    const dup = rowsFromTable([["name", "email"], ["A", "a@x.com"], ["A again", "A@X.com"]]);
    if (!dup.ok) throw new Error("expected ok");
    expect(dup.rows.map((x) => x.business_name)).toEqual(["A"]);
    expect(dup.skipped).toContainEqual({ reason: "duplicate", count: 1 });
  });
});

describe("checkFiles", () => {
  it("refuses too many, too big, unknown types and two lists", () => {
    const f = (name: string, size = 10) => ({ name, size });
    expect(checkFiles([f("a.txt"), f("b.txt"), f("c.txt"), f("d.txt"), f("e.txt"), f("f.txt")])).toMatchObject({ ok: false });
    expect(checkFiles([f("a.csv", 5 * 1024 * 1024)])).toMatchObject({ ok: false });
    expect(checkFiles([f("a.zip")])).toEqual({ ok: false, message: "a.zip: I can't read this kind of file" });
    expect(checkFiles([f("a.csv"), f("b.xlsx")])).toMatchObject({ ok: false });
    expect(checkFiles([f("a.csv"), f("brief.pdf"), f("shot.PNG")])).toEqual({ ok: true });
  });
  it("fileKind", () => {
    expect(fileKind("x.XLSX")).toBe("list");
    expect(fileKind("brief.pdf")).toBe("brief");
    expect(fileKind("notes.md")).toBe("brief");
    expect(fileKind("old.xls")).toBeNull();
  });
});

describe("filterKnown, clipBrief, importEstimate, websiteKindOf", () => {
  const row = (over: Partial<ImportRow>): ImportRow => ({ business_name: "B", website_url: null, email: null, phone: null, address: null, city: null, category: null, country_code: null, ...over });
  it("skips businesses already contacted or that asked not to be contacted", () => {
    const known = { emails: new Set(["a@x.com"]), phones: new Set(["5125550100"]), hosts: new Set(["joes.com"]), reason: new Map([["a@x.com", "asked not to be contacted"], ["5125550100", "already contacted"], ["joes.com", "already contacted"]]) };
    const r = filterKnown([row({ email: "a@x.com" }), row({ phone: "+1 (512) 555-0100" }), row({ website_url: "https://www.joes.com/contact" }), row({ email: "new@y.com" })], known);
    expect(r.rows.map((x) => x.email)).toEqual(["new@y.com"]);
    expect(r.skipped).toEqual([{ reason: "asked not to be contacted", count: 1 }, { reason: "already contacted", count: 2 }]);
  });
  it("small helpers", () => {
    expect(clipBrief("x".repeat(7000))).toHaveLength(6000);
    expect(clipBrief("  a \n\n  b  ")).toBe("a b");
    expect(importEstimate(100)).toBe(3.5);
    expect(websiteKindOf("https://facebook.com/joe")).toBe("facebook");
    expect(websiteKindOf("https://joes.com")).toBe("real");
    expect(websiteKindOf(null)).toBe("none");
  });
});

describe("attachmentsLine", () => {
  it("says what each file gave, in plain words", () => {
    expect(
      attachmentsLine([
        { name: "a.csv", kind: "list", used: 212, skipped: [{ reason: "no business name", count: 3 }, { reason: "duplicate", count: 0 }] },
        { name: "b.pdf", kind: "brief" },
        { name: "c.png", kind: "brief", note: "couldn't read it" },
      ]),
    ).toBe("Using: a.csv (212 leads, 3 skipped: no business name) · b.pdf (brief) · c.png (brief: couldn't read it)");
    expect(attachmentsLine([])).toBe("");
  });
});

describe("review fixes (27 Nov 2026)", () => {
  const base: ImportRow = { business_name: "Biz", website_url: null, email: null, phone: null, address: null, city: null, category: null, country_code: null };
  const known = (over: Partial<{ emails: string[]; phones: string[]; hosts: string[] }>) => ({
    emails: new Set(over.emails ?? []), phones: new Set(over.phones ?? []), hosts: new Set(over.hosts ?? []), reason: new Map<string, string>(),
  });

  it("C1: a row with no country takes the batch's, so the EU / UK block still applies", () => {
    expect(importLeadRow(base, "B1", "de").country_code).toBe("de");
    expect(importLeadRow({ ...base, country_code: "fr" }, "B1", "us").country_code).toBe("fr");
  });

  it("C1: a country written out is understood", () => {
    expect(countryCodeOf("Germany")).toBe("de");
    expect(countryCodeOf("United Kingdom")).toBe("gb");
    expect(countryCodeOf("UK")).toBe("gb");
    expect(countryCodeOf("USA")).toBe("us");
    expect(countryCodeOf("Nowhere-land")).toBeNull();
    const r = rowsFromTable([["Name", "Country"], ["A", "Germany"], ["B", "DE"], ["C", ""]]);
    if (!r.ok) throw new Error(r.message);
    expect(r.rows.map((x) => x.country_code)).toEqual(["de", "de", null]);
  });

  it("I2: Facebook pages and placeholders are not one business", () => {
    const r = rowsFromTable([["Name", "Website"], ["Joe", "facebook.com/joe"], ["Mary", "https://www.facebook.com/mary"], ["Ann", "N/A"], ["Bob", "-"], ["Al", "joes.com"], ["Al 2", "www.joes.com/contact"]]);
    if (!r.ok) throw new Error(r.message);
    expect(r.rows.map((x) => x.business_name)).toEqual(["Joe", "Mary", "Ann", "Bob", "Al"]);
    expect(r.rows.find((x) => x.business_name === "Ann")?.website_url).toBeNull();
    expect(siteKey("https://facebook.com/joe")).not.toBe(siteKey("https://facebook.com/mary"));
    expect(siteKey("https://www.joes.com/contact")).toBe("joes.com");
  });

  it("I2: a contacted Facebook-site lead doesn't skip every Facebook row", () => {
    const rows = [{ ...base, website_url: "https://facebook.com/joe" }];
    expect(filterKnown(rows, known({ hosts: ["facebook.com"] })).rows).toHaveLength(1);
  });

  it("I3: phones match whatever way they're written", () => {
    const k = known({ phones: ["5125550100"] });
    for (const phone of ["(512) 555-0100", "+1 512-555-0100", "15125550100"]) {
      expect(filterKnown([{ ...base, phone }], k).rows, phone).toHaveLength(0);
    }
  });
});
