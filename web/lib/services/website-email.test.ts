/**
 * website-email.test.ts — email / phone / contact-page extraction from real-world site markup.
 *
 * Inputs:  HTML shaped like deckor.com.mt (Cloudflare-protected footer email, "Get in touch" page) and others
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./headless-browser", () => ({ getBrowser: vi.fn(), buildProxyOptions: vi.fn() }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { contactLinks, decodeCfEmail, extractEmails, extractPhones, pickEmail } from "./website-email";

// "info@deckor.com.mt" XOR 0x2a, as Cloudflare writes it.
const CF = "2a" + [..."info@deckor.com.mt"].map((c) => (c.charCodeAt(0) ^ 0x2a).toString(16).padStart(2, "0")).join("");

describe("website-email extraction", () => {
  it("decodes a Cloudflare-protected footer email", () => {
    expect(decodeCfEmail(CF)).toBe("info@deckor.com.mt");
    const html = `<footer><a href="/cdn-cgi/l/email-protection#${CF}"><span class="__cf_email__" data-cfemail="${CF}">[email&#160;protected]</span></a></footer>`;
    expect(extractEmails(html)).toContain("info@deckor.com.mt");
  });

  it("reads mailto, plain text and [at]/[dot] spellings", () => {
    const html = `<a href="mailto:Sales@Shop.mt">x</a> write to bookings@shop.mt or office [at] shop [dot] mt`;
    expect(extractEmails(html)).toEqual(expect.arrayContaining(["sales@shop.mt", "bookings@shop.mt", "office@shop.mt"]));
  });

  it("drops image names and prefers the site's own role address", () => {
    expect(pickEmail(["asset-1@2x-1.svg", "someone@gmail.com", "info@deckor.com.mt"], "deckor.com.mt")).toBe("info@deckor.com.mt");
    expect(pickEmail(["asset-1@2x-1.svg"], "deckor.com.mt")).toBeNull();
  });

  it("takes phones from tel: links, decoded", () => {
    expect(extractPhones(`<a href="tel:+356%202762%206262">Call</a><a href="tel:123">short</a>`)).toEqual(["+356 2762 6262"]);
  });

  it("finds the contact and about pages whatever they're called, same site only", () => {
    const html = `
      <a href="https://deckor.com.mt/our-story/">Our Story</a>
      <a href="https://deckor.com.mt/get-in-touch/">Get in touch</a>
      <a href="/kuntatt">Kuntatt</a>
      <a href="https://deckor.com.mt/privacy-policy/">Privacy policy</a>
      <a href="https://facebook.com/deckor/contact">FB</a>
      <a href="/pagina"><span>Contatti</span></a>`;
    const r = contactLinks(html, "https://deckor.com.mt/");
    expect(r.contact).toEqual(["https://deckor.com.mt/get-in-touch/", "https://deckor.com.mt/kuntatt", "https://deckor.com.mt/pagina"]);
    expect(r.about).toEqual(["https://deckor.com.mt/our-story/"]);
  });
});
