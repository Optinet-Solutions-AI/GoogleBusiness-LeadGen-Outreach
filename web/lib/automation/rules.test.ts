/**
 * rules.test.ts — the automation rules (operator decisions 24 Nov 2026): auto-start batch emails 24 h after a batch
 * finishes, 10 automatic contact forms a day, one 100-lead scheduled batch each weekday within $40 a month.
 *
 * Inputs:  plain values (no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import {
  AUTO_EMAIL_DELAY_HOURS,
  FORMS_PER_DAY,
  MONTHLY_CAP_USD,
  SCHEDULED_BATCH_LIMIT,
  autoEmailDue,
  autoEmailStartAt,
  formLeadOk,
  formsRoom,
  monthStartUtc,
  nyClock,
  pickSchedule,
  scheduleDue,
  withinCap,
} from "./rules";

describe("the operator's numbers", () => {
  it("24 hours, 10 forms a day, 100 leads, $40 a month", () => {
    expect(AUTO_EMAIL_DELAY_HOURS).toBe(24);
    expect(FORMS_PER_DAY).toBe(10);
    expect(SCHEDULED_BATCH_LIMIT).toBe(100);
    expect(MONTHLY_CAP_USD).toBe(40);
  });
});

describe("auto-start batch emails", () => {
  it("starts 24 hours after the batch finished", () =>
    expect(autoEmailStartAt(new Date("2026-11-24T10:00:00Z"))).toBe("2026-11-25T10:00:00.000Z"));
  it("is due once its time has come, only while waiting", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    expect(autoEmailDue({ auto_email_state: "waiting", auto_email_at: "2026-11-25T09:59:00Z" }, now)).toBe(true);
    expect(autoEmailDue({ auto_email_state: "waiting", auto_email_at: "2026-11-25T10:01:00Z" }, now)).toBe(false);
    expect(autoEmailDue({ auto_email_state: "cancelled", auto_email_at: "2026-11-25T09:00:00Z" }, now)).toBe(false);
    expect(autoEmailDue({ auto_email_state: "started", auto_email_at: "2026-11-25T09:00:00Z" }, now)).toBe(false);
    expect(autoEmailDue({ auto_email_state: null, auto_email_at: null }, now)).toBe(false);
  });
});

describe("automatic contact forms", () => {
  const lead = {
    email: null,
    qualified: true,
    lifecycle_stage: "prospect",
    stage: "enriched",
    country_code: "us",
    website_url: "https://joesplumbing.com",
    contact_page_url: "https://joesplumbing.com/contact",
  };
  const o = { emailed: false, triedForm: false, includeEu: false };
  it("a lead with no email and a form on its own site", () => expect(formLeadOk(lead, o)).toBe(true));
  it("never a lead that has an email (it gets the email instead)", () => expect(formLeadOk({ ...lead, email: "joe@x.com" }, o)).toBe(false));
  it("never twice, never after an email, never past first contact, never unsubscribed or rejected", () => {
    expect(formLeadOk(lead, { ...o, triedForm: true })).toBe(false);
    expect(formLeadOk(lead, { ...o, emailed: true })).toBe(false);
    expect(formLeadOk({ ...lead, stage: "replied" }, o)).toBe(false);
    expect(formLeadOk({ ...lead, lifecycle_stage: "dnc" }, o)).toBe(false);
    expect(formLeadOk({ ...lead, qualified: false }, o)).toBe(false);
  });
  it("needs its own website or contact page (not a Facebook page)", () =>
    expect(formLeadOk({ ...lead, website_url: "https://facebook.com/joes", contact_page_url: null }, o)).toBe(false));
  it("EU / UK only when the batch email includes them", () => {
    expect(formLeadOk({ ...lead, country_code: "de" }, o)).toBe(false);
    expect(formLeadOk({ ...lead, country_code: "de" }, { ...o, includeEu: true })).toBe(true);
  });
  it("room left today: 10 minus the automatic sends in the last 24 hours, at most 2 per run", () => {
    expect(formsRoom(0)).toBe(2);
    expect(formsRoom(9)).toBe(1);
    expect(formsRoom(10)).toBe(0);
    expect(formsRoom(12)).toBe(0);
  });
});

describe("scheduled batches", () => {
  it("New York clock: weekday, hour and date", () => {
    // 2026-11-24 13:00 UTC = 08:00 Tuesday in New York.
    expect(nyClock(Date.parse("2026-11-24T13:00:00Z"))).toEqual({ weekday: 2, hour: 8, date: "2026-11-24" });
  });
  it("due on a weekday from 6:00 New York time, once a day", () => {
    const tueMorning = Date.parse("2026-11-24T12:00:00Z"); // 07:00 NY
    const tueEarly = Date.parse("2026-11-24T09:00:00Z"); // 04:00 NY
    const saturday = Date.parse("2026-11-28T15:00:00Z");
    expect(scheduleDue(tueMorning, false)).toBe(true);
    expect(scheduleDue(tueMorning, true)).toBe(false);
    expect(scheduleDue(tueEarly, false)).toBe(false);
    expect(scheduleDue(saturday, false)).toBe(false);
  });
  it("the next row: active only, never run first, then the longest ago", () => {
    const rows = [
      { id: "a", active: true, last_run_at: "2026-11-20T11:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      { id: "b", active: false, last_run_at: null, created_at: "2026-11-02T00:00:00Z" },
      { id: "c", active: true, last_run_at: null, created_at: "2026-11-03T00:00:00Z" },
      { id: "d", active: true, last_run_at: "2026-11-18T11:00:00Z", created_at: "2026-11-04T00:00:00Z" },
    ];
    expect(pickSchedule(rows)?.id).toBe("c");
    expect(pickSchedule(rows.filter((r) => r.id !== "c"))?.id).toBe("d");
    expect(pickSchedule([rows[1]])).toBeNull();
  });
  it("stays within $40 a month (this calendar month, UTC)", () => {
    expect(withinCap(38, 1.5)).toBe(true);
    expect(withinCap(39, 1.5)).toBe(false);
    expect(monthStartUtc(Date.parse("2026-11-24T13:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
  });
});
