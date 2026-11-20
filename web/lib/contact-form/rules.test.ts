import { describe, expect, it } from "vitest";
import {
  canReuseLook,
  effectiveStatus,
  isActive,
  leadHost,
  ownContactUrl,
  sameSite,
  senderName,
  STATUS_TEXT,
  type FormRun,
  type RunStatus,
} from "./rules";

const now = Date.parse("2026-11-20T12:00:00Z");
/** A run whose updated_at / created_at are `minsAgo` minutes before `now`. */
function run(status: RunStatus, minsAgo: number): FormRun {
  const t = new Date(now - minsAgo * 60_000).toISOString();
  return {
    id: "r1", lead_id: "l1", status, contact_url: null, form_shot_url: null, filled_shot_url: null, result_shot_url: null,
    sender_email: null, sender_name: null, subject: null, message: null, offer_key: null, fields: null, reason: null,
    usd: null, created_at: t, updated_at: t, sent_at: null,
  };
}

describe("senderName", () => {
  it("uses the mailbox display name", () => expect(senderName("Grace Lee", "grace@rp.rateupdigital.com")).toBe("Grace Lee"));
  it("falls back to the address's first part, capitalised", () =>
    expect(senderName(null, "grace@rp.rateupdigital.com")).toBe("Grace"));
  it("treats a blank name as missing", () => expect(senderName("  ", "ethan.b@x.com")).toBe("Ethan.b"));
});

describe("leadHost / ownContactUrl / sameSite", () => {
  it("takes the website's host without www", () =>
    expect(leadHost({ website_url: "https://www.Joes.com/a", contact_page_url: null })).toBe("joes.com"));
  it("uses the contact page when there's no website", () =>
    expect(leadHost({ website_url: null, contact_page_url: "https://joes.com/contact" })).toBe("joes.com"));
  it("is null with neither", () => expect(leadHost({ website_url: null, contact_page_url: null })).toBeNull());
  it("ignores a contact page on another site", () =>
    expect(ownContactUrl({ website_url: "https://joes.com", contact_page_url: "https://facebook.com/joes" })).toBeNull());
  it("keeps a contact page on their own site", () =>
    expect(ownContactUrl({ website_url: "https://joes.com", contact_page_url: "https://www.joes.com/contact" })).toBe(
      "https://www.joes.com/contact",
    ));
  it("matches hosts with or without www, and nothing else", () => {
    expect(sameSite("https://www.joes.com/contact", "joes.com")).toBe(true);
    expect(sameSite("https://joes.com.evil.io/", "joes.com")).toBe(false);
    expect(sameSite("not a url", "joes.com")).toBe(false);
  });
});

describe("stale runs", () => {
  it("a send stuck over 10 minutes may have gone out: unknown, never failed", () =>
    expect(effectiveStatus(run("sending", 11), now)).toBe("unknown"));
  it("a look stuck over 10 minutes failed", () => expect(effectiveStatus(run("looking", 11), now)).toBe("failed"));
  it("a recent send is still sending", () => expect(effectiveStatus(run("sending", 9), now)).toBe("sending"));
  it("active = looking or sending, not stale", () => {
    expect(isActive(run("sending", 2), now)).toBe(true);
    expect(isActive(run("sending", 11), now)).toBe(false);
    expect(isActive(run("ready", 1), now)).toBe(false);
  });
  it("reuses a ready look from the last 24 h only", () => {
    expect(canReuseLook(run("ready", 60 * 25), now)).toBe(false);
    expect(canReuseLook(run("ready", 60), now)).toBe(true);
    expect(canReuseLook(run("sent", 60), now)).toBe(false);
  });
  it("has a plain sentence for every status", () => {
    for (const s of ["looking", "ready", "no_form", "sending", "sent", "blocked", "failed", "unknown"] as RunStatus[]) {
      expect(STATUS_TEXT[s]).toMatch(/\w/);
    }
    expect(STATUS_TEXT.unknown).toMatch(/check their page/i);
  });
});
