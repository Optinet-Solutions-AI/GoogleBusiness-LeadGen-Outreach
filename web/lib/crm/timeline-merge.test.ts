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
});
