import { describe, it, expect } from "vitest";
import { computeKpis, resolveRange, type KpiLead, type KpiEvent } from "./kpis";

// Wed 2026-06-17 → ISO week starts Mon 2026-06-15; month starts 2026-06-01.
const NOW = new Date("2026-06-17T12:00:00Z");

const lead = (over: Partial<KpiLead>): KpiLead => ({
  qualified: true,
  email: null,
  phone: null,
  stage: "scraped",
  created_at: "2026-06-16T00:00:00Z",
  updated_at: "2026-06-16T00:00:00Z",
  ...over,
});

const LEADS: KpiLead[] = [
  lead({ email: "a@x.com", phone: "+1", created_at: "2026-06-16T00:00:00Z" }), // this week
  lead({ phone: "+1", created_at: "2026-06-16T00:00:00Z" }), // this week, no email
  lead({ email: "c@x.com", created_at: "2026-06-02T00:00:00Z" }), // this month, not week
  lead({ created_at: "2026-05-20T00:00:00Z" }), // before this month
  lead({ qualified: false, created_at: "2026-06-16T00:00:00Z" }), // disqualified → excluded
  lead({ stage: "meeting_booked", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-16T00:00:00Z" }),
  lead({ stage: "closed_won", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-16T00:00:00Z" }),
];

const EVENTS: KpiEvent[] = [
  { kind: "email_sent", created_at: "2026-06-16T00:00:00Z" },
  { kind: "email_sent", created_at: "2026-06-16T00:00:00Z" },
  { kind: "sms_sent", created_at: "2026-06-16T00:00:00Z" },
  { kind: "replied", created_at: "2026-06-16T00:00:00Z" },
  { kind: "email_opened", created_at: "2026-06-16T00:00:00Z" }, // neither sent nor reply
];

const STAGE_EVENTS = [
  { to_stage: "meeting_booked", created_at: "2026-06-16T00:00:00Z" },
  { to_stage: "closed_won", created_at: "2026-06-16T00:00:00Z" },
];

describe("resolveRange", () => {
  it("defaults to all-time", () => {
    expect(resolveRange({}, NOW)).toMatchObject({ key: "all", start: null, end: null });
  });
  it("computes preset bounds", () => {
    expect(resolveRange({ range: "week" }, NOW).start).toBe("2026-06-15T00:00:00.000Z");
    expect(resolveRange({ range: "month" }, NOW).start).toBe("2026-06-01T00:00:00.000Z");
  });
  it("computes a custom from/to range (inclusive end-of-day)", () => {
    const r = resolveRange({ from: "2026-06-10", to: "2026-06-12" }, NOW);
    expect(r.key).toBe("custom");
    expect(r.start).toBe("2026-06-10T00:00:00.000Z");
    expect(r.end).toBe("2026-06-12T23:59:59.999Z");
    expect(r.from).toBe("2026-06-10");
    expect(r.to).toBe("2026-06-12");
  });
  it("ignores malformed dates and falls back to preset", () => {
    expect(resolveRange({ from: "not-a-date" }, NOW).key).toBe("all");
  });
});

describe("computeKpis", () => {
  it("all-time counts qualified leads + stage-events", () => {
    const k = computeKpis(LEADS, EVENTS, resolveRange({}, NOW), STAGE_EVENTS);
    expect(k.leads_generated).toBe(6);
    expect(k.emails_collected).toBe(2);
    expect(k.phones_collected).toBe(2);
    expect(k.meetings_booked).toBe(1);
    expect(k.deals_closed).toBe(1);
  });

  it("meetings/deals are dated by the stage-event, not the lead", () => {
    const oldEvt = [{ to_stage: "meeting_booked", created_at: "2026-05-01T00:00:00Z" }];
    expect(computeKpis(LEADS, EVENTS, resolveRange({ range: "week" }, NOW), oldEvt).meetings_booked).toBe(0);
    expect(computeKpis(LEADS, EVENTS, resolveRange({}, NOW), oldEvt).meetings_booked).toBe(1);
  });

  it("outreach volume = sends only; response rate = replies / volume", () => {
    const k = computeKpis(LEADS, EVENTS, resolveRange({}, NOW));
    expect(k.outreach_volume).toBe(3); // 2 email_sent + 1 sms_sent
    expect(k.replies).toBe(1);
    expect(k.response_rate).toBeCloseTo(33.3, 0);
    expect(k.outreach_empty).toBe(false);
  });

  it("the week preset excludes leads acquired before Monday", () => {
    const k = computeKpis(LEADS, EVENTS, resolveRange({ range: "week" }, NOW));
    expect(k.leads_generated).toBe(2);
    expect(k.emails_collected).toBe(1);
  });

  it("a custom range filters by both start and end", () => {
    // 06-15 .. 06-17 includes the two 06-16 leads; excludes 06-02 and 05-20.
    const k = computeKpis(LEADS, EVENTS, resolveRange({ from: "2026-06-15", to: "2026-06-17" }, NOW));
    expect(k.leads_generated).toBe(2);
    // a window entirely before any lead (all created in 2026) → zero
    const empty = computeKpis(LEADS, EVENTS, resolveRange({ from: "2025-01-01", to: "2025-12-31" }, NOW));
    expect(empty.leads_generated).toBe(0);
  });

  it("response rate is null and outreach_empty true when nothing was sent", () => {
    const k = computeKpis(LEADS, [], resolveRange({}, NOW));
    expect(k.response_rate).toBeNull();
    expect(k.outreach_empty).toBe(true);
  });
});
