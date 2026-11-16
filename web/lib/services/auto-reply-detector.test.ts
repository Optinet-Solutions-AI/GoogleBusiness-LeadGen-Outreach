/**
 * auto-reply-detector.test.ts — bounce (NDR) detection, so the email sequence
 * STOPS on a bad address instead of following up (reputation protection).
 */

import { describe, it, expect } from "vitest";
import { classifyReply } from "./auto-reply-detector";

describe("classifyReply — bounce / NDR detection", () => {
  it("hard bounce: mailer-daemon + 5.x.x / user unknown", () => {
    const v = classifyReply({
      headers: {
        from: "Mail Delivery System <MAILER-DAEMON@mail.example.com>",
        "content-type": 'multipart/report; report-type=delivery-status; boundary="x"',
      },
      subject: "Undeliverable: A quick idea for Joe's Plumbing",
      body: "550 5.1.1 The email account that you tried to reach does not exist (user unknown).",
    });
    expect(v.isBounce).toBe(true);
    expect(v.bounceKind).toBe("hard");
    expect(v.kind).toBe("auto");
  });

  it("soft bounce: over quota / 4.x.x", () => {
    const v = classifyReply({
      headers: { from: "postmaster@mail.example.com" },
      subject: "Delivery Status Notification (Delay)",
      body: "452 4.2.2 The recipient's mailbox is over quota, please try again later.",
    });
    expect(v.isBounce).toBe(true);
    expect(v.bounceKind).toBe("soft");
  });

  it("X-Failed-Recipients header alone marks a bounce", () => {
    const v = classifyReply({
      headers: { "x-failed-recipients": "deadbox@example.com" },
      subject: "Mail delivery failed",
      body: "550 no such user",
    });
    expect(v.isBounce).toBe(true);
  });

  it("a real human reply is NOT a bounce", () => {
    const v = classifyReply({
      headers: { from: "owner@joesplumbing.com" },
      subject: "Re: A quick idea for Joe's Plumbing",
      body: "Yes! Please send it over, looks interesting.",
    });
    expect(v.isBounce).toBe(false);
    expect(v.bounceKind).toBeNull();
    expect(v.kind).toBe("human");
  });

  it("an unsubscribe is flagged as unsubscribe, not a bounce", () => {
    const v = classifyReply({
      headers: { from: "owner@x.com" },
      subject: "stop",
      body: "please remove me / unsubscribe",
    });
    expect(v.isBounce).toBe(false);
    expect(v.isUnsubscribe).toBe(true);
  });
});

describe("classifyReply — only the sender's own words count (16 Nov 2026)", () => {
  // The email we send carries Ongage's footer ("In order to unsubscribe from this mailing list…"). Gmail quotes it
  // under every reply, so reading the quoted part marked an interested "yes tell me more" as an unsubscribe.
  const quoted = [
    "yes tell me more",
    "",
    "",
    "On Mon, Nov 16, 2026 at 7:11 PM Grace <grace@rp.rateupdigital.com>",
    "wrote:",
    "",
    "> Hi there,",
    "> When Acme is busy or closed, what happens to the calls nobody picks up?",
    "> In order to unsubscribe from this mailing list, please click here",
  ].join("\n");

  it("a real reply quoting our unsubscribe footer is a human reply, not an unsubscribe", () => {
    const v = classifyReply({ headers: {}, subject: "Re: Missed calls at Acme", body: quoted });
    expect(v.isUnsubscribe).toBe(false);
    expect(v.kind).toBe("human");
  });

  it("an unsubscribe written by the sender above the quote still counts", () => {
    const v = classifyReply({ headers: {}, subject: "Re: Missed calls at Acme", body: quoted.replace("yes tell me more", "please remove me") });
    expect(v.isUnsubscribe).toBe(true);
  });

  it("cuts an Outlook-style quote too", () => {
    const body = "Sounds good, call me.\n\n-----Original Message-----\nFrom: Grace\nTo unsubscribe click here";
    expect(classifyReply({ headers: {}, subject: "RE: hi", body }).isUnsubscribe).toBe(false);
  });
});
