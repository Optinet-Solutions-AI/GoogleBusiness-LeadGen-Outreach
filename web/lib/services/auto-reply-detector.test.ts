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
