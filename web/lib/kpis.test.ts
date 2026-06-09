import { describe, it, expect } from "vitest";
import { computeKpis, rangeStart, type KpiLead, type KpiEvent, type KpiCall } from "./kpis";

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

const CALLS: KpiCall[] = [
  { status: "completed", created_at: "2026-06-16T00:00:00Z" }, // placed
  { status: "queued", created_at: "2026-06-16T00:00:00Z" }, // not placed
];

describe("computeKpis", () => {
  it("all-time counts qualified leads only", () => {
    const k = computeKpis(LEADS, EVENTS, CALLS, "all", NOW);
    expect(k.leads_generated).toBe(6);
    expect(k.emails_collected).toBe(2);
    expect(k.phones_collected).toBe(2);
    expect(k.meetings_booked).toBe(1);
    expect(k.deals_closed).toBe(1);
  });

  it("outreach volume = sends + placed calls; response rate = replies / volume", () => {
    const k = computeKpis(LEADS, EVENTS, CALLS, "all", NOW);
    expect(k.outreach_volume).toBe(4); // 2 email_sent + 1 sms_sent + 1 placed call (queued excluded)
    expect(k.replies).toBe(1);
    expect(k.response_rate).toBe(25);
    expect(k.outreach_empty).toBe(false);
  });

  it("the week range excludes leads acquired before Monday", () => {
    const k = computeKpis(LEADS, EVENTS, CALLS, "week", NOW);
    expect(k.leads_generated).toBe(2); // only the two 06-16 leads
    expect(k.emails_collected).toBe(1);
    expect(k.phones_collected).toBe(2);
  });

  it("response rate is null and outreach_empty true when nothing was sent", () => {
    const k = computeKpis(LEADS, [], [], "all", NOW);
    expect(k.outreach_volume).toBe(0);
    expect(k.response_rate).toBeNull();
    expect(k.outreach_empty).toBe(true);
  });

  it("rangeStart returns null for all-time and a Monday for week", () => {
    expect(rangeStart("all", NOW)).toBeNull();
    expect(rangeStart("week", NOW)).toBe("2026-06-15T00:00:00.000Z");
    expect(rangeStart("month", NOW)).toBe("2026-06-01T00:00:00.000Z");
  });
});
