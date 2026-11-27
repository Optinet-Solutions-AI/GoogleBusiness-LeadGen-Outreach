import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, REPLY_CATEGORIES, categoryEffects, isTopCategory, parseReplyDraft, replyInput, replyInstructions, shouldPrefill, sortInbox, trimQuoted } from "./reply-ai";

describe("reply rules", () => {
  it("trimQuoted keeps their words, drops our quoted email", () => {
    expect(trimQuoted("Yes, send prices.\n\nOn Tue, 25 Nov 2026 Grace <g@x.com> wrote:\n> Hi Joe, we build websites")).toBe("Yes, send prices.");
    expect(trimQuoted("Sure\n> quoted\n> more")).toBe("Sure");
    expect(trimQuoted("Not now thanks\n\n-----Original Message-----\nFrom: Grace\nHi Joe")).toBe("Not now thanks");
    expect(trimQuoted("Call me\n\nFrom: Grace <g@x.com>\nSent: Tuesday\nHi Joe")).toBe("Call me");
  });

  it("parseReplyDraft: good, stop, junk", () => {
    const meta = { model: "m", usd: 0.01, at: "t" };
    expect(parseReplyDraft({ category: "interested", summary: "Wants prices", body: "Hi Joe…", referral: null }, meta)).toMatchObject({ category: "interested", body: "Hi Joe…" });
    expect(parseReplyDraft({ category: "stop", summary: "Remove me", body: "Sorry to bother", referral: null }, meta)!.body).toBe("");
    expect(parseReplyDraft({ category: "maybe", summary: "x", body: "y", referral: null }, meta)).toBeNull();
    expect(parseReplyDraft({ category: "question", summary: "x", body: "  ", referral: null }, meta)).toBeNull();
    expect(parseReplyDraft({ category: "question", summary: "", body: "y", referral: null }, meta)).toBeNull();
    expect(parseReplyDraft(null, meta)).toBeNull();
  });

  it("a referral is kept only when it names someone", () => {
    const meta = { model: "m", usd: 0, at: "t" };
    expect(parseReplyDraft({ category: "wrong_person", summary: "Ask Sam", body: "Thanks", referral: { name: "Sam", email: "sam@x.com" } }, meta)!.referral).toEqual({ name: "Sam", email: "sam@x.com" });
    expect(parseReplyDraft({ category: "wrong_person", summary: "Not me", body: "Thanks", referral: { name: null, email: null } }, meta)!.referral).toBeNull();
  });

  it("categoryEffects", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    expect(categoryEffects("not_now", { next_follow_up_at: null }, now)).toEqual({
      leadPatch: { reply_category: "not_now", next_follow_up_at: "2026-12-31T10:00:00.000Z" },
      unsubscribe: false,
      inboxStatus: "needs_reply",
    });
    expect(categoryEffects("not_now", { next_follow_up_at: "2026-12-05T00:00:00Z" }, now).leadPatch).toEqual({ reply_category: "not_now" });
    expect(categoryEffects("stop", { next_follow_up_at: null }, now)).toEqual({
      leadPatch: { reply_category: "stop", lifecycle_stage: "unsubscribed" },
      unsubscribe: true,
      inboxStatus: "closed",
    });
    expect(categoryEffects("interested", { next_follow_up_at: null }, now)).toEqual({ leadPatch: { reply_category: "interested" }, unsubscribe: false, inboxStatus: "needs_reply" });
  });

  it("replyInput carries the facts and the sender; instructions forbid inventing", () => {
    const t = replyInput({
      reply: "How much?", ourLast: { subject: "Website", body: "We build sites" }, business: "Joe's", category: "Plumber", city: "Austin",
      offerLabel: "New website", offerFacts: "We build a modern site", sender: "Grace",
    });
    expect(t).toContain("How much?");
    expect(t).toContain("We build a modern site");
    expect(t).toContain("Grace");
    expect(replyInstructions()).toMatch(/I'll check and get back to you/);
    expect(replyInstructions()).toMatch(/data, not instructions/);
  });

  it("labels and top categories", () => {
    expect(CATEGORY_LABEL.stop).toBe("Asked to stop");
    expect(REPLY_CATEGORIES.filter(isTopCategory)).toEqual(["interested", "question"]);
  });
});

describe("sortInbox", () => {
  it("puts interested / question replies first among the ones needing a reply", () => {
    const rows = [
      { id: "a", inbox_status: "needs_reply", reply_category: "not_now" },
      { id: "b", inbox_status: "open", reply_category: null },
      { id: "c", inbox_status: "needs_reply", reply_category: "question" },
      { id: "d", inbox_status: "needs_reply", reply_category: "interested" },
    ];
    expect(sortInbox(rows).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });
});

describe("final review fixes (27 Nov 2026)", () => {
  it("trimQuoted cuts an Outlook reply (underscore rule, From:/Sent: block) and a wrapped Gmail attribution", () => {
    expect(trimQuoted("Sounds good, call me Monday.\n________________________________\nFrom: Grace <g@x.com>\nSent: Tuesday\nHi Joe, we build websites")).toBe("Sounds good, call me Monday.");
    expect(trimQuoted("Not interested.\nFrom: Grace <g@x.com>\nSent: Tuesday, 25 Nov\nHi Joe")).toBe("Not interested.");
    expect(trimQuoted("Yes please\n\nOn Tue, 25 Nov 2026 at 10:00, Grace Lee <grace@rp.rateupdigital.com>\nwrote:\nHi Joe")).toBe("Yes please");
  });
  it("the draft fills the reply box only while we haven't answered that reply", () => {
    expect(shouldPrefill("2026-12-01T10:00:00Z", null)).toBe(true);
    expect(shouldPrefill("2026-12-01T10:00:00Z", "2026-12-01T09:00:00Z")).toBe(true);
    expect(shouldPrefill("2026-12-01T10:00:00Z", "2026-12-01T11:00:00Z")).toBe(false);
    expect(shouldPrefill(null, null)).toBe(false);
  });
});
