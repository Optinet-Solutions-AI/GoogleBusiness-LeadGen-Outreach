/**
 * email-results.test.ts — the scoreboard: which email each send used, and which got replies (24 Nov 2026).
 *
 * Inputs:  email_sent events (with what was recorded about the email) and reply / unsubscribe / bounce events
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { resultRows, testResult, usedOf, type ResponseEvent, type SendEvent } from "./email-results";

const SEO = { key: "service:seo", label: "SEO (show up higher on Google)" };
const send = (lead: string, at: string, used: Record<string, unknown> | null, extra: Record<string, unknown> = {}): SendEvent => ({
  lead_id: lead,
  at,
  meta: { manual: true, ...(used ? { email_used: used } : {}), ...extra },
});
const resp = (lead: string, at: string, kind: ResponseEvent["kind"]): ResponseEvent => ({ lead_id: lead, at, kind });

describe("usedOf", () => {
  it("reads the email recorded with the send", () =>
    expect(usedOf({ manual: true, email_used: { ...SEO, edited: true } })).toMatchObject({ ...SEO, edited: true }));
  it("a classic sequence email by its step; a Send email follow-up as a follow-up", () => {
    expect(usedOf({ step: 2 })).toMatchObject({ key: "sequence:2", label: "Classic sequence, email 2", edited: false });
    expect(usedOf({ step: 2, follow_up: true })).toMatchObject({ key: "follow_up:1", label: "Send email follow-up 1", edited: false });
  });
  it("an older send with nothing recorded is 'Before tracking'", () =>
    expect(usedOf({ manual: true, subject: "Hi" })).toMatchObject({ key: "untracked", label: "Before tracking" }));
});

describe("resultRows", () => {
  it("credits a reply to the last email sent to that lead before it, and counts edited sends", () => {
    const rows = resultRows(
      [
        send("L1", "2026-11-01T10:00:00Z", { ...SEO, edited: false }),
        send("L2", "2026-11-02T10:00:00Z", { ...SEO, edited: true }),
        send("L3", "2026-11-03T10:00:00Z", { key: "service:website_build", label: "New website", edited: false }),
        { lead_id: "L1", at: "2026-11-05T10:00:00Z", meta: { step: 2, follow_up: true } },
      ],
      [
        resp("L2", "2026-11-03T09:00:00Z", "email_reply"),
        resp("L1", "2026-11-06T09:00:00Z", "email_reply"),
        resp("L3", "2026-11-04T09:00:00Z", "email_unsubscribe"),
        resp("L3", "2026-11-04T10:00:00Z", "email_bounced"),
      ],
    );
    expect(rows.find((r) => r.key === "service:seo")).toEqual({ key: "service:seo", label: SEO.label, sent: 2, edited: 1, replies: 1, unsubscribed: 0, bounced: 0, rate: 0.5 });
    expect(rows.find((r) => r.key === "follow_up:1")).toMatchObject({ sent: 1, replies: 1 });
    expect(rows.find((r) => r.key === "service:website_build")).toMatchObject({ sent: 1, replies: 0, unsubscribed: 1, bounced: 1, rate: 0 });
  });
  it("two replies to one email count once; a reply before any email counts for nothing", () => {
    const rows = resultRows(
      [send("L1", "2026-11-02T10:00:00Z", { ...SEO, edited: false })],
      [resp("L1", "2026-11-01T10:00:00Z", "email_reply"), resp("L1", "2026-11-03T10:00:00Z", "email_reply"), resp("L1", "2026-11-04T10:00:00Z", "email_reply")],
    );
    expect(rows).toEqual([{ key: "service:seo", label: SEO.label, sent: 1, edited: 0, replies: 1, unsubscribed: 0, bounced: 0, rate: 1 }]);
  });
  it("a spam complaint counts with the unsubscribes", () =>
    expect(resultRows([send("L1", "2026-11-02T10:00:00Z", { ...SEO, edited: false })], [resp("L1", "2026-11-03T10:00:00Z", "email_complaint")])[0]).toMatchObject({ unsubscribed: 1 }));
  it("a send that didn't really go out (no mailbox connected) isn't counted", () =>
    expect(resultRows([send("L1", "2026-11-02T10:00:00Z", null, { step: 1, noop: true, manual: false })], [])).toEqual([]));
  it("most sent first, 'Before tracking' last, and the latest label wins", () => {
    const rows = resultRows(
      [
        send("L1", "2026-11-01T10:00:00Z", null),
        send("L2", "2026-11-02T10:00:00Z", null),
        send("L3", "2026-11-03T10:00:00Z", { key: "saved:t1", label: "Locksmith (v1)", edited: false }),
        send("L4", "2026-11-04T10:00:00Z", { key: "saved:t1", label: "Locksmith v2 (v2)", edited: false }),
        send("L5", "2026-11-05T10:00:00Z", { ...SEO, edited: false }),
      ],
      [],
    );
    expect(rows.map((r) => r.key)).toEqual(["saved:t1", "service:seo", "untracked"]);
    expect(rows[0].label).toBe("Locksmith v2 (v2)");
  });
});

describe("resultRows for a period", () => {
  it("shows only the period's sends, but a reply to an older email stays with that older email", () => {
    const rows = resultRows(
      [send("L1", "2026-10-01T10:00:00Z", { ...SEO, edited: false }), send("L2", "2026-11-20T10:00:00Z", { ...SEO, edited: false })],
      [resp("L1", "2026-11-21T10:00:00Z", "email_reply")],
      "2026-11-01T00:00:00Z",
    );
    expect(rows).toEqual([{ key: "service:seo", label: SEO.label, sent: 1, edited: 0, replies: 0, unsubscribed: 0, bounced: 0, rate: 0 }]);
  });
});

describe("testResult", () => {
  const used = (variant: "A" | "B") => ({ key: variant === "A" ? "service:seo" : "saved:b1", label: variant, edited: false, test_id: "t1", variant });
  it("splits the test's sends into A and B (sends from other tests or none are ignored)", () => {
    const r = testResult(
      "t1",
      [
        send("L1", "2026-11-01T10:00:00Z", used("A")),
        send("L2", "2026-11-01T11:00:00Z", used("B")),
        send("L3", "2026-11-01T12:00:00Z", used("B")),
        send("L4", "2026-11-01T13:00:00Z", { ...used("A"), test_id: "other" }),
        send("L5", "2026-11-01T14:00:00Z", { ...SEO, edited: false }),
      ],
      [resp("L3", "2026-11-02T10:00:00Z", "email_reply")],
    );
    expect(r.a).toMatchObject({ sent: 1, replies: 0 });
    expect(r.b).toMatchObject({ sent: 2, replies: 1, rate: 0.5 });
    expect(r.enough).toBe(false);
  });
  it("is 'enough' once each version has 30 sends", () => {
    const sends = Array.from({ length: 60 }, (_, i) => send(`L${i}`, "2026-11-01T10:00:00Z", used(i % 2 ? "B" : "A")));
    expect(testResult("t1", sends, []).enough).toBe(true);
    expect(testResult("t1", sends.slice(0, 59), []).enough).toBe(false);
  });
});
