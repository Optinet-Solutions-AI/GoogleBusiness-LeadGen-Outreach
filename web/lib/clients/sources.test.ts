/**
 * sources.test.ts — unit tests for the pure autoSourcesForLead mapping and source-URL normalisation.
 *
 * Inputs:  lead website/demo fields
 * Outputs: pass/fail
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { autoSourcesForLead, normalizeSourceUrl } from "./sources";

describe("autoSourcesForLead", () => {
  it("adds demo_site and website for a real site", () => {
    const r = autoSourcesForLead({
      demo_url: "https://x.pages.dev",
      website_url: "https://x.com",
      website_kind: "real",
    });
    expect(r).toEqual([
      { kind: "google_maps", url: null },
      { kind: "demo_site", url: "https://x.pages.dev" },
      { kind: "website", url: "https://x.com" },
    ]);
  });

  it("maps an instagram kind to an instagram source", () => {
    const r = autoSourcesForLead({
      demo_url: null,
      website_url: "https://instagram.com/x",
      website_kind: "instagram",
    });
    expect(r).toEqual([
      { kind: "google_maps", url: null },
      { kind: "instagram", url: "https://instagram.com/x" },
    ]);
  });

  it("returns only google_maps when nothing else is known", () => {
    expect(
      autoSourcesForLead({ demo_url: null, website_url: null, website_kind: "none" }),
    ).toEqual([{ kind: "google_maps", url: null }]);
  });
});

describe("normalizeSourceUrl", () => {
  it("keeps http(s) URLs and adds https:// to a bare host", () => {
    expect(normalizeSourceUrl(" https://acme.com/ ")).toBe("https://acme.com/");
    expect(normalizeSourceUrl("HTTP://acme.com")).toBe("HTTP://acme.com");
    expect(normalizeSourceUrl("acme.com")).toBe("https://acme.com");
    expect(normalizeSourceUrl("acme.com:8080/x")).toBe("https://acme.com:8080/x");
  });
  it("refuses other schemes", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://acme.com"]) {
      expect(() => normalizeSourceUrl(u)).toThrow("http(s)");
    }
  });
});
