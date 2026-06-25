/**
 * parking.test.ts — locks parked / for-sale domain detection.
 * Regression: First Class Auto's domain redirects to HugeDomains, so we scraped
 * the "HugeDomains" parking logo instead of the business's.
 */
import { describe, it, expect } from "vitest";
import { isParkingHost, looksParked } from "./parking";

describe("isParkingHost", () => {
  it("flags HugeDomains static asset host", () => {
    expect(isParkingHost("https://static.hugedomains.com/images/hd-header-logo-v3.svg")).toBe(true);
  });
  it("flags a parking marketplace host", () => {
    expect(isParkingHost("https://www.sedo.com/search/")).toBe(true);
    expect(isParkingHost("https://dan.com/buy-domain/foo.com")).toBe(true);
  });
  it("does NOT flag a real business host", () => {
    expect(isParkingHost("https://www.joesplumbing.com/logo.png")).toBe(false);
  });
  it("handles junk", () => {
    expect(isParkingHost(null)).toBe(false);
    expect(isParkingHost("not a url")).toBe(false);
  });
});

describe("looksParked", () => {
  it("flags by final URL host (redirected to HugeDomains)", () => {
    expect(looksParked("<html></html>", "https://www.hugedomains.com/domain_profile.cfm?d=x.com")).toBe(true);
  });
  it("flags the real First Class parked page title", () => {
    const html = "<title>FirstClassAutoService.com is for sale | HugeDomains</title>";
    expect(looksParked(html, "http://firstclassautoservice.com/")).toBe(true);
  });
  it("flags a 'buy this domain' lander", () => {
    expect(looksParked("<h1>Buy this domain</h1> the owner of this domain ...", "https://x.com")).toBe(true);
  });
  it("does NOT flag a real business selling things ('for sale' without a parking brand)", () => {
    const html = "<title>Joe's Auto</title><p>Quality used cars for sale in Phoenix</p>";
    expect(looksParked(html, "https://joesauto.com")).toBe(false);
  });
  it("does NOT flag an empty/normal page", () => {
    expect(looksParked("<title>Welcome to Acme</title>", "https://acme.com")).toBe(false);
    expect(looksParked(null, "https://acme.com")).toBe(false);
  });
});
