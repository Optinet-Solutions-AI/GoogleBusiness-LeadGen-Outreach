/**
 * batch-email.test.ts — "Email this batch": who gets an email, which email, and what is handed to the scheduler
 * (operator decisions 24 Nov 2026: 10 a day, Send email's offers / saved templates, follow-ups off, EU left out).
 *
 * Inputs:  lead rows, saved templates, running wording tests
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { SKIP_TEXT, buildLeadPlan, emailFor, makeEmailPicker, offerFor, sendingDays, skipReason, type BatchLead } from "./batch-email";

const LEAD: BatchLead = {
  id: "L1",
  business_name: "Joe's Plumbing",
  email: "joe@joesplumbing.com",
  verification_status: "valid",
  qualified: true,
  lifecycle_stage: "prospect",
  stage: "enriched",
  seq_status: "none",
  country_code: "us",
  call_segment: "has_website",
  website_kind: "real",
  has_website: true,
  needs_improvement: false,
  signal_type: null,
  signal_meta: null,
  contact_owner_name: "Joe Smith",
  category: "Plumber",
  demo_url: null,
  ai_profile: null,
};
const none = new Set<string>();

describe("skipReason in Test mode", () => {
  it("leaves out an address that isn't on the test list", () => {
    const l = { ...LEAD, email: "owner@realplumber.com" };
    const tm = { on: true, emails: ["qa@test.example"], phones: [], hosts: [] };
    expect(skipReason(l, { emailed: new Set(), includeEu: false, testMode: tm })).toBe("test_mode");
    expect(skipReason({ ...l, email: "qa@test.example" }, { emailed: new Set(), includeEu: false, testMode: tm })).toBeNull();
    expect(SKIP_TEXT.test_mode).toMatch(/Test mode/);
  });
});

describe("skipReason (who gets an email)", () => {
  it("a qualified lead with a good email that was never emailed gets one", () => expect(skipReason(LEAD, { emailed: none, includeEu: false })).toBeNull());
  it("a never-checked email still gets one (it's checked right before sending)", () =>
    expect(skipReason({ ...LEAD, verification_status: null }, { emailed: none, includeEu: false })).toBeNull());
  it("skips with a reason", () => {
    const o = { emailed: none, includeEu: false };
    expect(skipReason({ ...LEAD, qualified: false }, o)).toBe("not_qualified");
    expect(skipReason({ ...LEAD, email: null }, o)).toBe("no_email");
    expect(skipReason({ ...LEAD, lifecycle_stage: "unsubscribed" }, o)).toBe("unsubscribed");
    expect(skipReason({ ...LEAD, lifecycle_stage: "dnc" }, o)).toBe("unsubscribed");
    expect(skipReason({ ...LEAD, stage: "replied" }, o)).toBe("replied_or_closed");
    expect(skipReason({ ...LEAD, stage: "closed_lost" }, o)).toBe("replied_or_closed");
    expect(skipReason(LEAD, { ...o, emailed: new Set(["L1"]) })).toBe("emailed_before");
    expect(skipReason({ ...LEAD, seq_status: "active" }, o)).toBe("in_sequence");
    expect(skipReason({ ...LEAD, verification_status: "invalid" }, o)).toBe("bad_address");
  });
  it("skips a local business whose main email AI Lookup marked as a head office's or franchise's (QA 23 Nov 2026)", () => {
    const o = { emailed: none, includeEu: false };
    const corp = { ...LEAD, email: "marketing@rrsc.com", ai_profile: { emails: ["marketing@rrsc.com"], email_notes: { "marketing@rrsc.com": "Roto-Rooter corporate marketing" } } };
    expect(skipReason(corp, o)).toBe("head_office_email");
    expect(skipReason({ ...corp, signal_type: "closure" }, o)).toBeNull();
    expect(skipReason({ ...LEAD, ai_profile: { emails: ["joe@joesplumbing.com"], email_notes: {} } }, o)).toBeNull();
  });
  it("leaves EU / UK leads out unless they are switched on", () => {
    expect(skipReason({ ...LEAD, country_code: "de" }, { emailed: none, includeEu: false })).toBe("eu");
    expect(skipReason({ ...LEAD, country_code: "gb" }, { emailed: none, includeEu: false })).toBe("eu");
    expect(skipReason({ ...LEAD, country_code: "de" }, { emailed: none, includeEu: true })).toBeNull();
  });
});

describe("offerFor (the offer Send email would pick)", () => {
  it("by the lead's segment", () => {
    expect(offerFor(LEAD)).toBe("ai_receptionist");
    expect(offerFor({ ...LEAD, call_segment: "no_website", has_website: false, website_kind: "none" })).toBe("website_build");
    expect(offerFor({ ...LEAD, call_segment: null, signal_type: "closure" })).toBe("buy_inventory");
    expect(offerFor({ ...LEAD, call_segment: null, signal_type: "exhibitor" })).toBe("booth_build");
  });
});

describe("makeEmailPicker (which email each lead gets)", () => {
  const saved = [{ id: "s1", name: "Short AI pitch", version: 2, service_key: "ai_receptionist", subject: "Calls at {{business}}", body: "Hi {{first_name}}", follow_up_1: "", follow_up_2: "" }];
  it("the ready-made email by default", () =>
    expect(makeEmailPicker({ tests: [], winners: {} }).pick("ai_receptionist", "auto")).toEqual({ key: "service:ai_receptionist", test: null }));
  it("a saved template the operator chose for the offer", () =>
    expect(makeEmailPicker({ tests: [], winners: {} }).pick("ai_receptionist", "saved:s1")).toEqual({ key: "saved:s1", test: null }));
  it("a running wording test takes turns from where it stands, A on a tie", () => {
    const p = makeEmailPicker({ tests: [{ id: "t1", serviceKey: "ai_receptionist", aKey: "service:ai_receptionist", bKey: "saved:s1", sentA: 3, sentB: 2 }], winners: {} });
    expect([p.pick("ai_receptionist", "auto"), p.pick("ai_receptionist", "auto"), p.pick("ai_receptionist", "auto")].map((x) => x.test?.variant)).toEqual(["B", "A", "B"]);
    expect(p.pick("ai_receptionist", "auto").key).toBe("service:ai_receptionist");
  });
  it("a template chosen by hand is outside the test", () => {
    const p = makeEmailPicker({ tests: [{ id: "t1", serviceKey: "ai_receptionist", aKey: "service:ai_receptionist", bKey: "saved:s1", sentA: 0, sentB: 0 }], winners: {} });
    expect(p.pick("ai_receptionist", "saved:s1")).toEqual({ key: "saved:s1", test: null });
  });
  it("the last test's winner when no test runs", () =>
    expect(makeEmailPicker({ tests: [], winners: { ai_receptionist: "saved:s1" } }).pick("ai_receptionist", "auto")).toEqual({ key: "saved:s1", test: null }));

  it("emailFor fills a saved template with the lead's details", () => {
    const e = emailFor("saved:s1", "ai_receptionist", LEAD, { city: "Austin, TX", senderName: "Grace" }, saved);
    expect(e).toMatchObject({ key: "saved:s1", subject: "Calls at Joe's Plumbing", body: "Hi Joe" });
  });
  it("emailFor falls back to the ready-made email when a saved template can't be filled for this lead", () => {
    const needsDemo = [{ ...saved[0], body: "See your sample: {{demo_link}}" }];
    expect(emailFor("saved:s1", "ai_receptionist", LEAD, { city: null, senderName: "Grace" }, needsDemo)?.key).toBe("service:ai_receptionist");
    expect(emailFor("saved:gone", "ai_receptionist", LEAD, { city: null, senderName: "Grace" }, saved)?.key).toBe("service:ai_receptionist");
  });
  it("emailFor signs the ready-made email with the sender's name", () => {
    const e = emailFor("service:ai_receptionist", "ai_receptionist", LEAD, { city: null, senderName: "Grace" }, []);
    expect(e?.body).toMatch(/Grace/);
    expect(e?.subject.length).toBeGreaterThan(0);
  });
});

describe("buildLeadPlan (what the scheduler is handed)", () => {
  const email = {
    key: "service:seo",
    label: "SEO (show up higher on Google)",
    subject: "Hi",
    body: "First email",
    followUps: [
      { subject: "Re: Hi", body: "Follow one" },
      { subject: "One more idea", body: "Follow two" },
      { subject: "Re: Hi", body: "Follow three" },
    ],
  };
  it("the first email with what it is, the campaign and the daily limit; no follow-ups by default", () => {
    const p = buildLeadPlan({ email, test: null, followUps: 0, campaignId: "c1", dailyLimit: 10, sender: "grace@rp.rateupdigital.com", sendAt: "2026-11-25T14:00:00.000Z" });
    expect(p).toEqual({
      seq_status: "active",
      seq_step: 0,
      seq_next_step_at: "2026-11-25T14:00:00.000Z",
      seq_sender_email: "grace@rp.rateupdigital.com",
      seq_max_step: 1,
      seq_copy_overrides: {
        "1": { subject: "Hi", body: "First email", campaign_id: "c1", daily_limit: 10, used: { key: "service:seo", label: "SEO (show up higher on Google)", edited: false } },
      },
    });
  });
  it("follow-ups when switched on go with their own subjects (up to 3), and the wording test version is kept", () => {
    const p = buildLeadPlan({ email, test: { id: "t1", variant: "B" }, followUps: 3, campaignId: "c1", dailyLimit: 10, sender: "g@x.com", sendAt: "2026-11-25T14:00:00.000Z" });
    expect(p.seq_max_step).toBe(4);
    expect(p.seq_copy_overrides["1"].used).toMatchObject({ test_id: "t1", variant: "B" });
    expect(p.seq_copy_overrides["2"]).toEqual({ subject: "Re: Hi", body: "Follow one", campaign_id: "c1" });
    expect(p.seq_copy_overrides["3"]).toEqual({ subject: "One more idea", body: "Follow two", campaign_id: "c1" });
    expect(p.seq_copy_overrides["4"]).toEqual({ subject: "Re: Hi", body: "Follow three", campaign_id: "c1" });
    expect(buildLeadPlan({ email, test: null, followUps: 2, campaignId: "c1", dailyLimit: 10, sender: "g@x.com", sendAt: "x" }).seq_max_step).toBe(3);
  });
});

describe("sendingDays (how many weekdays the first emails take)", () => {
  it("counts the distinct days in the batch's time zone", () => {
    const times = ["2026-11-25T14:00:00Z", "2026-11-25T21:00:00Z", "2026-11-26T14:00:00Z", "2026-11-28T15:00:00Z"];
    expect(sendingDays(times, "America/New_York")).toBe(3);
    expect(sendingDays([], "America/New_York")).toBe(0);
  });
});

describe("emailFor: follow-up subjects (25 Nov 2026)", () => {
  const lead = { business_name: "Joe's", contact_owner_name: null, category: "Plumber", demo_url: null, signal_meta: null } as unknown as Parameters<typeof emailFor>[2];
  it("ready-made: three follow-ups, each a reply to the first email", () => {
    const e = emailFor("service:seo", "seo", lead, { city: null, senderName: null }, []);
    expect(e.followUps).toHaveLength(3);
    expect(e.followUps.every((f) => f.subject === `Re: ${e.subject}`)).toBe(true);
  });
  it("saved template: its own follow-up subjects, else a reply", () => {
    const saved = [{
      id: "s9", name: "Mine", version: 1, service_key: "seo", subject: "Google for {{business}}", body: "Hello",
      follow_up_1: "One", follow_up_2: "Two", follow_up_3: "Three",
      follow_up_subject_1: "", follow_up_subject_2: "Idea for {{business}}", follow_up_subject_3: "",
    }];
    const e = emailFor("saved:s9", "seo", lead, { city: null, senderName: null }, saved);
    expect(e.followUps).toEqual([
      { subject: "Re: Google for Joe's", body: "One" },
      { subject: "Idea for Joe's", body: "Two" },
      { subject: "Re: Google for Joe's", body: "Three" },
    ]);
  });
});
