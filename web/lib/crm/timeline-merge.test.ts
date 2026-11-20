import { describe, it, expect } from "vitest";
import { mergeTimeline } from "./timeline-merge";

describe("mergeTimeline", () => {
  it("sorts newest first across tables and labels each row", () => {
    const items = mergeTimeline({
      stageEvents: [{ id: "s1", from_stage: "outreached", to_stage: "replied", created_at: "2026-11-02T10:00:00Z" }],
      notes: [{ id: "n1", body: "  Owner wants a call Friday  ", author: "Meny", created_at: "2026-11-03T10:00:00Z" }],
      calls: [{ id: "c1", status: "completed", outcome: "interested", duration_sec: 125, created_at: "2026-11-01T10:00:00Z", ended_at: "2026-11-01T10:03:00Z", meta: { summary: "Wants pricing" } }],
      messages: [{ id: "m1", direction: "inbound", subject: "Re: site", body_snippet: "Looks good", body_text: null, status: "received", created_at: "2026-11-02T09:00:00Z" }],
    });
    expect(items.map((i) => i.id)).toEqual(["note:n1", "stage:s1", "msg:m1", "call:c1"]);
    expect(items[0]).toMatchObject({ kind: "note", title: "Note by Meny", detail: "Owner wants a call Friday" });
    expect(items[1].title).toBe("Contacted → Replied");
    expect(items[2]).toMatchObject({ kind: "email_in", title: "Reply received", detail: "Re: site — Looks good" });
    expect(items[3]).toMatchObject({ kind: "call", title: "AI call: interested, 2 min", detail: "Wants pricing" });
    expect(items[3].callId).toBe("c1");
    expect(items[0].callId).toBeUndefined();
  });

  it("drops outreach_events rows that email_messages or call_attempts already cover", () => {
    const items = mergeTimeline({
      events: [
        { id: "e1", kind: "email_sent", meta: { step: 1 }, created_at: "2026-11-01T00:00:00Z" },
        { id: "e2", kind: "call_placed", meta: null, created_at: "2026-11-01T00:00:00Z" },
        { id: "e3", kind: "email_bounced", meta: null, created_at: "2026-11-01T01:00:00Z" },
      ],
      messages: [{ id: "m1", direction: "outbound", subject: "Hi", body_snippet: null, body_text: null, status: "sent", created_at: "2026-11-01T00:00:00Z" }],
    });
    expect(items.map((i) => i.id)).toEqual(["ev:e3", "msg:m1"]);
    expect(items[0]).toMatchObject({ kind: "email_issue", title: "Email bounced" });
  });

  it("keeps email_sent events (with the step) when there are no email_messages rows", () => {
    const items = mergeTimeline({ events: [{ id: "e1", kind: "email_sent", meta: { step: 2, subject: "Your site" }, created_at: "2026-11-01T00:00:00Z" }] });
    expect(items[0]).toMatchObject({ kind: "email_out", title: "Email sent (step 2)", detail: "Your site" });
  });

  it("clips long details", () => {
    const items = mergeTimeline({ notes: [{ id: "n", body: "x".repeat(400), author: null, created_at: "2026-11-01T00:00:00Z" }] });
    expect(items[0].title).toBe("Note");
    expect(items[0].detail!.length).toBe(400); // notes are not clipped — they are the operator's own words
  });

  it("a browser test call is labelled as a test, not an AI call to the lead", () => {
    const items = mergeTimeline({ calls: [{ id: "t1", status: "completed", outcome: null, duration_sec: 95, created_at: "2026-11-20T10:00:00Z", ended_at: "2026-11-20T10:02:00Z", meta: { call_type: "browser_test", agent_name: "SEO (show up higher on Google)" } }] });
    expect(items[0]).toMatchObject({ kind: "call", title: "Test call (browser): SEO (show up higher on Google), 2 min", callId: "t1" });
  });

  it("labels contact form sends and failures with the subject", () => {
    const items = mergeTimeline({
      events: [
        { id: "f1", kind: "contact_form_sent", meta: { subject: "Quick idea for Joe's" }, created_at: "2026-11-20T10:00:00Z" },
        { id: "f2", kind: "contact_form_failed", meta: null, created_at: "2026-11-19T10:00:00Z" },
      ],
    });
    expect(items[0]).toMatchObject({ title: "Contact form sent", detail: "Quick idea for Joe's" });
    expect(items[1]).toMatchObject({ title: "Contact form failed" });
  });
});
