import { describe, expect, it } from "vitest";
import { checkFiles, clipBrief, fileKind, filterKnown, importEstimate, parseCsv, rowsFromTable, websiteKindOf, type ImportRow } from "./attachments";

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
    const known = { emails: new Set(["a@x.com"]), phones: new Set(["15125550100"]), hosts: new Set(["joes.com"]), reason: new Map([["a@x.com", "asked not to be contacted"], ["15125550100", "already contacted"], ["joes.com", "already contacted"]]) };
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
