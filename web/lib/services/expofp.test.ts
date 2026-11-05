import { describe, it, expect } from "vitest";
import { expoFpSlugs, parseExpoFpData } from "./expofp";

describe("expoFpSlugs", () => {
  it("finds event plan hosts and ignores the shared app hosts", () => {
    const html = `<a href="https://techshowmadrid2026.expofp.com/">plan</a> <a href="https://app.expofp.com/login">x</a> https://demo.expofp.com/ https://SIGMA-ROME.expofp.com/?x=1`;
    expect(expoFpSlugs(html)).toEqual(["techshowmadrid2026", "sigma-rome"]);
    expect(expoFpSlugs("https://example.com")).toEqual([]);
  });
});

describe("parseExpoFpData", () => {
  const js = `var __data = {"title":"Tech Show Madrid 2026","subtitle":"IFEMA | Nov 4–5","startDate":"2026-11-04","endDate":"2026-11-05","homeUrl":"https://techshow.es",
    "exhibitors":[{"id":1,"name":"Oracle","website":"oracle.com","description":"<p>Cloud &amp; data</p>","linkedin":"https://linkedin.com/company/oracle"},{"id":2,"name":"  2bedigital ","website":"https://2bedigital.com/"},{"id":3,"name":""}],
    "booths":[{"name":"3A10","exhibitors":[1]},{"name":"3A12","exhibitors":[1,2]},{"name":"","exhibitors":[2]}]};`;
  it("reads exhibitors with normalised websites and their booths", () => {
    const plan = parseExpoFpData(js, "techshowmadrid2026");
    expect(plan).toMatchObject({ slug: "techshowmadrid2026", title: "Tech Show Madrid 2026", start_date: "2026-11-04", end_date: "2026-11-05", home_url: "https://techshow.es" });
    expect(plan.exhibitors).toHaveLength(2);
    expect(plan.exhibitors[0]).toMatchObject({ name: "Oracle", website: "https://oracle.com", description: "Cloud &amp; data", booths: ["3A10", "3A12"], socials: { linkedin: "https://linkedin.com/company/oracle" } });
    expect(plan.exhibitors[1]).toMatchObject({ name: "2bedigital", website: "https://2bedigital.com/", booths: ["3A12"] });
  });
  it("accepts plain JSON and a BOM", () => {
    expect(parseExpoFpData('﻿{"title":"X","exhibitors":[]}', "x").title).toBe("X");
  });
});
