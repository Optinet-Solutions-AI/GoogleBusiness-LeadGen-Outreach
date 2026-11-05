import { describe, it, expect } from "vitest";
import { briefFromAnalysis } from "./remake";
import { startUrlFor, isPullLive, PullInputError } from "./pulls";

const analysis = {
  hook: "bold question",
  angle: "do it yourself",
  why_it_works: "x",
  structure: ["question", "proof", "offer"],
  tone: "friendly, direct",
  offer_shape: "trial kit",
  our_title: "Try our flooring at home",
  our_brief: "  Lead with a question about weekend projects. Show the click-lock range. End with a free quote CTA.  ",
  template_key: "offer" as const,
  cta_kind: "book" as const,
  video_script: [],
  cautions: [],
};

describe("briefFromAnalysis", () => {
  it("writes the brief, the technique and the no-copy rule", () => {
    const b = briefFromAnalysis(analysis, "Flooret");
    expect(b.startsWith("Lead with a question")).toBe(true);
    expect(b).toContain("Hook style: bold question. Angle: do it yourself. Tone: friendly, direct. Offer shape: trial kit.");
    expect(b).toContain("1. question 2. proof 3. offer");
    expect(b).toContain("Inspired by an ad from Flooret — do not reuse");
    expect(briefFromAnalysis(analysis, null)).toContain("from a competitor");
  });
});

describe("startUrlFor", () => {
  it("uses the given Meta URL, or builds a search", () => {
    expect(startUrlFor({ source_url: "https://www.facebook.com/ads/library/?id=1", query: null, country: "us", media_type: "all", active_only: true })).toBe("https://www.facebook.com/ads/library/?id=1");
    expect(startUrlFor({ source_url: null, query: "gym", country: "mt", media_type: "video", active_only: false })).toContain("country=MT");
  });
  it("refuses non-facebook URLs and empty input", () => {
    expect(() => startUrlFor({ source_url: "https://google.com", query: null, country: "us", media_type: "all", active_only: true })).toThrow(PullInputError);
    expect(() => startUrlFor({ source_url: null, query: " ", country: "us", media_type: "all", active_only: true })).toThrow(PullInputError);
  });
});

describe("isPullLive", () => {
  it("queued is live; running goes stale after 20 minutes", () => {
    const now = Date.parse("2026-11-05T10:00:00Z");
    expect(isPullLive({ status: "queued", started_at: null }, now)).toBe(true);
    expect(isPullLive({ status: "running", started_at: "2026-11-05T09:50:00Z" }, now)).toBe(true);
    expect(isPullLive({ status: "running", started_at: "2026-11-05T09:30:00Z" }, now)).toBe(false);
    expect(isPullLive({ status: "done", started_at: "2026-11-05T09:59:00Z" }, now)).toBe(false);
  });
});
