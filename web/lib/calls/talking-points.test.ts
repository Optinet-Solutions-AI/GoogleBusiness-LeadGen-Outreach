import { describe, expect, it } from "vitest";
import {
  TALKING_POINTS_MAX,
  emailOffer,
  pickTalkingPoints,
  serviceOffer,
  talkingPointsFromEmail,
  type LastEmail,
} from "./talking-points";

const BODY = [
  "Hi there,",
  "",
  "I came across Zoom Drain on Google in Austin and couldn't find a website for you.",
  "",
  "I went ahead and made a sample so you can see what it could look like:",
  "https://zoom-drain.pages.dev",
  "",
  "It's on us, with nothing to sign.",
  "",
  "What do you think?",
  "",
  "Thanks,",
  "Grace",
].join("\n");

describe("talkingPointsFromEmail", () => {
  it("turns the email into one paragraph of prose: subject first, no greeting, link or sign-off", () => {
    const t = talkingPointsFromEmail("A website for Zoom Drain", BODY);
    expect(t).toBe(
      "Email subject: A website for Zoom Drain. I came across Zoom Drain on Google in Austin and couldn't find a website for you. " +
        "I went ahead and made a sample so you can see what it could look like. It's on us, with nothing to sign. What do you think?",
    );
    expect(t).not.toMatch(/https?:|Hi there|Thanks|Grace|\n/);
  });

  it("drops the other greetings and sign-offs too", () => {
    const t = talkingPointsFromEmail("Quick question", "Hey Zoom Drain team,\n\nWe answer your calls.\n\nBest regards,\nEthan\nRateUp");
    expect(t).toBe("Email subject: Quick question. We answer your calls.");
  });

  it("never goes over 500 characters, and cuts at the end of a sentence", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const t = talkingPointsFromEmail("Subject", long);
    expect(t.length).toBeLessThanOrEqual(TALKING_POINTS_MAX);
    expect(t.endsWith(".")).toBe(true);
    expect(t.length).toBeGreaterThan(400);
  });

  it("cuts a single very long sentence at a word, still under 500", () => {
    const t = talkingPointsFromEmail("S", `${"word ".repeat(200)}end`);
    expect(t.length).toBeLessThanOrEqual(TALKING_POINTS_MAX);
    expect(t.endsWith("word.")).toBe(true);
  });

  it("is empty when there is nothing to say", () => {
    expect(talkingPointsFromEmail("", "Hi there,\n\nThanks,\nGrace")).toBe("");
  });
});

describe("serviceOffer / emailOffer", () => {
  it("maps the old offer names to the email offers", () => {
    expect(serviceOffer("build_website")).toBe("website_build");
    expect(serviceOffer("improve_website")).toBe("website_redesign");
    expect(serviceOffer("voice_agent")).toBe("ai_receptionist");
    expect(serviceOffer("seo")).toBe("seo");
    expect(serviceOffer("custom")).toBeNull();
    expect(serviceOffer(null)).toBeNull();
  });

  it("reads the offer an email was for", () => {
    expect(emailOffer("service:ai_receptionist", null)).toBe("ai_receptionist");
    expect(emailOffer("saved:123", "seo")).toBe("seo");
    expect(emailOffer("saved:123", null)).toBeNull();
    expect(emailOffer(null, null)).toBeNull();
  });
});

describe("pickTalkingPoints", () => {
  const lead = { businessName: "Zoom Drain", category: "Plumber" };
  const sent = (usedKey: string | null, templateOffer: string | null = null): LastEmail => ({
    subject: "Missed calls at Zoom Drain",
    body: "Hi there,\n\nOur agent answers when you can't.\n\nThanks,\nGrace",
    usedKey,
    templateOffer,
  });

  it("uses the email the lead got when it was for the same offer", () => {
    const p = pickTalkingPoints("ai_receptionist", sent("service:ai_receptionist"), lead);
    expect(p).toEqual({ text: "Email subject: Missed calls at Zoom Drain. Our agent answers when you can't.", source: "sent" });
  });

  it("a saved template counts when it was written for that offer", () => {
    expect(pickTalkingPoints("voice_agent", sent("saved:1", "ai_receptionist"), lead)?.source).toBe("sent");
  });

  it("falls back to the offer's ready-made email when the last email was for another offer (or unknown)", () => {
    for (const last of [sent("service:seo"), sent(null), sent("saved:1", null), null]) {
      const p = pickTalkingPoints("ai_receptionist", last, lead);
      expect(p?.source).toBe("ready_made");
      expect(p?.text).toMatch(/^Email subject: /);
      expect(p?.text).toContain("Zoom Drain");
      expect(p!.text.length).toBeLessThanOrEqual(TALKING_POINTS_MAX);
    }
  });

  it("has nothing for an offer with no email", () => {
    expect(pickTalkingPoints(null, null, lead)).toBeNull();
    expect(pickTalkingPoints("custom", sent("service:seo"), lead)).toBeNull();
  });
});
