/**
 * website-review.test.ts — the OpenAI website check's rules: reading the AI's answer, the verdict → pitch, and the
 * details the lead page shows.
 *
 * Inputs:  sample AI answers + page signals
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { bookingFrom, checkRows, parseReview, platformFrom, reviewFields, reviewPrompt, PITCH_LABEL, VERDICT_LABEL, type SiteSignals } from "./website-review";

const signals: SiteSignals = {
  final_url: "https://joesplumbing.com/",
  https: true,
  mobile_meta: true,
  load_seconds: 2.4,
  copyright_year: 2018,
  has_contact_form: true,
  has_booking: false,
  platform: "Wix",
  title: "Joe's Plumbing",
};
const ctx = { signals, screenshot_url: "https://x/shot.jpg", model: "gpt-5.4-mini", usd: 0.004, checked_at: "2026-11-25T00:00:00Z" };
const answer = {
  is_business_site: true,
  verdict: "old_website",
  score: 45,
  summary: "A working site that looks about ten years old.",
  design: "Small text, stock photos, cluttered menu.",
  reasons: ["Copyright 2018", "No online booking", "Cramped on a phone"],
  pitch_why: "They get calls from the site but it looks dated next to competitors.",
  pitch_ideas: ["A clean one-page design", "Click-to-call button", "Online booking"],
};

describe("reading the AI's answer", () => {
  it("keeps the verdict, score, reasons and pitch, and adds the page checks and screenshot", () => {
    const r = parseReview(answer, ctx)!;
    expect(r.verdict).toBe("old_website");
    expect(r.score).toBe(45);
    expect(r.reasons).toEqual(["Copyright 2018", "No online booking", "Cramped on a phone"]);
    expect(r.pitch).toEqual({ offer: "website_redesign", why: answer.pitch_why, ideas: answer.pitch_ideas });
    expect(r.checks).toEqual(signals);
    expect(r.screenshot_url).toBe("https://x/shot.jpg");
    expect(r.usd).toBe(0.004);
  });

  it("a page that isn't really their business site counts as no website, pitched a new one", () => {
    const r = parseReview({ ...answer, is_business_site: false, verdict: "good_website", score: 80 }, ctx)!;
    expect(r.verdict).toBe("no_website");
    expect(r.pitch.offer).toBe("website_build");
  });

  it("a good site is pitched AI services, never a website", () => {
    expect(parseReview({ ...answer, verdict: "good_website", score: 85 }, ctx)!.pitch.offer).toBe("ai_services");
  });

  it("clamps the score to 0–100 and trims long lists", () => {
    const r = parseReview({ ...answer, score: 140, reasons: Array(12).fill("x"), pitch_ideas: Array(9).fill("y") }, ctx)!;
    expect(r.score).toBe(100);
    expect(r.reasons).toHaveLength(6);
    expect(r.pitch.ideas).toHaveLength(4);
  });

  it("an unreadable or unknown answer gives null (the old check stays)", () => {
    expect(parseReview(null, ctx)).toBeNull();
    expect(parseReview({ ...answer, verdict: "great" }, ctx)).toBeNull();
    expect(parseReview("nope", ctx)).toBeNull();
  });
});

describe("what the verdict changes on the lead", () => {
  const base = parseReview(answer, ctx)!;
  it("old website → needs improvement, its score and reasons", () => {
    expect(reviewFields(base)).toEqual({ has_website: true, website_kind: "real", needs_improvement: true, website_score: 45, website_issues: base.reasons });
  });
  it("good website → healthy", () => {
    expect(reviewFields({ ...base, verdict: "good_website" }).needs_improvement).toBe(false);
  });
  it("no website → not a real site, so the lead is pitched a new one", () => {
    // website_kind "none" too, like a parked domain: Build (stage 2) would otherwise read the address as a real site
    // and flip the lead back to AI services (review, 25 Nov 2026).
    expect(reviewFields({ ...base, verdict: "no_website" })).toMatchObject({ has_website: false, website_kind: "none", needs_improvement: false });
  });
});

describe("the technical checks shown on the lead page", () => {
  it("one plain row per check, marked good / bad / unknown", () => {
    const rows = checkRows(signals);
    expect(rows).toContainEqual({ label: "Secure (https)", value: "Yes", ok: true });
    expect(rows).toContainEqual({ label: "Works on phones", value: "Yes", ok: true });
    expect(rows).toContainEqual({ label: "Load time", value: "2.4 s", ok: true });
    expect(rows).toContainEqual({ label: "Newest year on the page", value: "2018", ok: false });
    expect(rows).toContainEqual({ label: "Online booking", value: "No", ok: false });
    expect(rows).toContainEqual({ label: "Built with", value: "Wix", ok: null });
  });
  it("a slow page or one without a phone layout is marked bad", () => {
    const rows = checkRows({ ...signals, load_seconds: 7.9, mobile_meta: false, https: false });
    expect(rows).toContainEqual({ label: "Load time", value: "7.9 s", ok: false });
    expect(rows).toContainEqual({ label: "Works on phones", value: "No", ok: false });
    expect(rows).toContainEqual({ label: "Secure (https)", value: "No", ok: false });
  });
});

describe("the prompt", () => {
  it("names the business, what we measured and the three verdicts", () => {
    const p = reviewPrompt({ business_name: "Joe's Plumbing", category: "Plumber", city: "Austin, TX", url: "https://joesplumbing.com", signals, text: "Welcome to Joe's" });
    for (const w of ["Joe's Plumbing", "Plumber", "Austin, TX", "no_website", "old_website", "good_website", "2018", "Welcome to Joe's"]) expect(p).toContain(w);
  });
});

describe("labels", () => {
  it("plain words for each verdict and pitch", () => {
    expect(VERDICT_LABEL.old_website).toMatch(/old/i);
    expect(PITCH_LABEL.ai_services).toMatch(/AI/);
  });
});

describe("spotting the site builder and online booking from the page", () => {
  it("names the builder from the generator tag or the page's code", () => {
    expect(platformFrom({ generator: "WordPress 6.4", html: "" })).toBe("WordPress");
    expect(platformFrom({ generator: null, html: '<script src="https://static.wixstatic.com/x.js">' })).toBe("Wix");
    expect(platformFrom({ generator: null, html: '<link href="https://static1.squarespace.com/a.css">' })).toBe("Squarespace");
    expect(platformFrom({ generator: null, html: '<script src="https://cdn.shopify.com/s.js">' })).toBe("Shopify");
    expect(platformFrom({ generator: "GoDaddy Website Builder", html: "" })).toBe("GoDaddy");
    expect(platformFrom({ generator: null, html: "<div>plain</div>" })).toBeNull();
  });
  it("sees online booking from the words or a known booking tool", () => {
    expect(bookingFrom({ text: "Book online now", html: "" })).toBe(true);
    expect(bookingFrom({ text: "Schedule an appointment", html: "" })).toBe(true);
    expect(bookingFrom({ text: "Call us", html: '<a href="https://www.opentable.com/r/x">' })).toBe(true);
    expect(bookingFrom({ text: "Call us", html: '<iframe src="https://calendly.com/joe">' })).toBe(true);
    expect(bookingFrom({ text: "Call us today", html: "<p>hi</p>" })).toBe(false);
  });
});
