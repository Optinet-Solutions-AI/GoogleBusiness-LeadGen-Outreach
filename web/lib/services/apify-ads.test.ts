import { describe, it, expect } from "vitest";
import { adLibrarySearchUrl, isMetaUrl, normalizeMetaAd, type ApifyAdItem } from "./apify-ads";

const item: ApifyAdItem = {
  adArchiveID: "1679178620437349",
  pageID: "272748842914765",
  isActive: true,
  publisherPlatform: ["FACEBOOK", "INSTAGRAM"],
  startDateFormatted: "2026-09-23T07:00:00.000Z",
  endDate: 1793779200,
  snapshot: {
    pageName: "Flooret",
    pageProfileUri: "https://www.facebook.com/Flooret.Brand/",
    pageCategories: ["Home Repair"],
    title: "Get 50% Off Sample Kits",
    body: { text: "Install it yourself in one weekend." },
    linkUrl: "https://try.flooret.com/diy/#kits",
    linkDescription: "Code: DIY",
    ctaText: "Shop now",
    displayFormat: "VIDEO",
    videos: [{ videoHdUrl: "https://video.fbcdn.net/a.mp4", videoPreviewImageUrl: "https://scontent.fbcdn.net/p.jpg" }],
    images: [],
    cards: [],
  },
};

describe("normalizeMetaAd", () => {
  it("maps a video ad", () => {
    const ad = normalizeMetaAd(item)!;
    expect(ad).toMatchObject({
      source_ad_id: "1679178620437349",
      page_name: "Flooret",
      page_category: "Home Repair",
      title: "Get 50% Off Sample Kits",
      body: "Install it yourself in one weekend.",
      cta_text: "Shop now",
      media_kind: "video",
      video_url: "https://video.fbcdn.net/a.mp4",
      thumbnail_url: "https://scontent.fbcdn.net/p.jpg",
      platforms: ["facebook", "instagram"],
      started_at: "2026-09-23T07:00:00.000Z",
      ended_at: "2026-11-04T08:00:00.000Z",
      is_active: true,
      ad_library_url: "https://www.facebook.com/ads/library/?id=1679178620437349",
    });
  });
  it("maps an image ad and a carousel, with snake_case fields too", () => {
    const img = normalizeMetaAd({ adArchiveId: "2", snapshot: { body: "plain", images: [{ original_image_url: "https://x/1.jpg" }], displayFormat: "IMAGE" } })!;
    expect(img).toMatchObject({ media_kind: "image", image_urls: ["https://x/1.jpg"], thumbnail_url: "https://x/1.jpg", body: "plain" });
    const car = normalizeMetaAd({ adArchiveId: "3", snapshot: { displayFormat: "CAROUSEL", cards: [{ originalImageUrl: "a", title: "T1" }, { resizedImageUrl: "b" }] } })!;
    expect(car).toMatchObject({ media_kind: "carousel", image_urls: ["a", "b"], title: "T1" });
  });
  it("drops items without an ad id", () => {
    expect(normalizeMetaAd({ snapshot: {} })).toBeNull();
  });
});

describe("urls", () => {
  it("builds a keyword search URL", () => {
    const u = adLibrarySearchUrl("flooring store", "mt", "video", true);
    expect(u).toContain("https://www.facebook.com/ads/library/?");
    expect(u).toContain("country=MT");
    expect(u).toContain("q=flooring+store");
    expect(u).toContain("media_type=video");
    expect(u).toContain("active_status=active");
    expect(adLibrarySearchUrl("x", "us", "all", false)).not.toContain("media_type");
  });
  it("recognises facebook URLs only", () => {
    expect(isMetaUrl("https://www.facebook.com/ads/library/?id=1")).toBe(true);
    expect(isMetaUrl("https://google.com")).toBe(false);
    expect(isMetaUrl("nope")).toBe(false);
  });
});
