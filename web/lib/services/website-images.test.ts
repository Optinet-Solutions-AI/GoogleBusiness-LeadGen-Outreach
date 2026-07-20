/**
 * website-images.test.ts — locks the old-site content-image extractor.
 * Ensures we grab real content photos, resolve relative URLs to absolute,
 * and exclude logos / badges / icons / parked-domain landers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { extractWebsiteImages } from "./website-images";

function mockFetchHtml(html: string, finalUrl = "https://joesplumbing.com/") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ),
  );
  // Response.url is read-only via the constructor; override for the redirect check.
  vi.spyOn(Response.prototype, "url", "get").mockReturnValue(finalUrl);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractWebsiteImages", () => {
  it("collects content <img> + og:image and resolves relative URLs to absolute", async () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://joesplumbing.com/hero.jpg" />
      </head><body>
        <img src="/images/team.jpg" alt="our team" />
        <img src="gallery/job1.png" alt="finished job" />
      </body></html>`;
    mockFetchHtml(html);
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toContain("https://joesplumbing.com/hero.jpg");
    expect(out).toContain("https://joesplumbing.com/images/team.jpg");
    expect(out).toContain("https://joesplumbing.com/gallery/job1.png");
  });

  it("excludes logos, icons, and third-party badges", async () => {
    const html = `
      <img src="/assets/logo.png" class="site-logo" alt="Company logo" />
      <img src="/favicon-32.png" />
      <img src="https://cdn.trustpilot.com/badge.png" alt="Trustpilot rating" />
      <img src="/sprite-icons.svg" />
      <img src="/photos/storefront.jpg" alt="storefront" />`;
    mockFetchHtml(html);
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toEqual(["https://joesplumbing.com/photos/storefront.jpg"]);
  });

  it("picks the largest srcset candidate", async () => {
    const html = `<img srcset="/small.jpg 480w, /large.jpg 1600w" alt="hero" />`;
    mockFetchHtml(html);
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toContain("https://joesplumbing.com/large.jpg");
  });

  it("reads inline background-image url()", async () => {
    const html = `<section style="background-image: url('/bg/hero-bg.jpg')">hi</section>`;
    mockFetchHtml(html);
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toContain("https://joesplumbing.com/bg/hero-bg.jpg");
  });

  it("returns [] for a parked domain", async () => {
    const html = `<title>joesplumbing.com is for sale | HugeDomains</title>`;
    mockFetchHtml(html, "https://www.hugedomains.com/domain_profile.cfm?d=joesplumbing.com");
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toEqual([]);
  });

  it("caps at 8 images and dedupes", async () => {
    const imgs = Array.from({ length: 15 }, (_, i) => `<img src="/p${i}.jpg" alt="photo ${i}" />`).join("");
    // A duplicate of the first should not double-count.
    mockFetchHtml(imgs + `<img src="/p0.jpg" alt="dup" />`);
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out.length).toBe(8);
    expect(new Set(out).size).toBe(8);
  });

  it("never throws on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const out = await extractWebsiteImages("https://joesplumbing.com");
    expect(out).toEqual([]);
  });
});
