/**
 * approve.test.ts — approving a Brain plan: once only, never wider than the plan allowed, re-checked against today's
 * facts, and nothing left half-started when it fails.
 *
 * Inputs:  fake deps (no db, no email campaign)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { approvePlan, type ApproveDeps, type Pick as PlanPick } from "./approve";
import type { JudgeLead } from "./judge";
import type { BrainJob } from "./jobs";
import type { SavedRow } from "./plan";
import { DEFAULT_SETTINGS } from "./rules";

const NOW = Date.parse("2026-11-26T15:00:00Z");
const lead = (id: string, over: Partial<JudgeLead> = {}): JudgeLead => ({
  id, business_name: `Biz ${id}`, email: `${id}@biz.com`, verification_status: "valid", qualified: true, lifecycle_stage: "prospect",
  stage: "scraped", seq_status: "none", country_code: "us", call_segment: "no_website", website_kind: null, has_website: false, needs_improvement: null,
  signal_type: null, signal_meta: null, contact_owner_name: null, category: "Plumber", demo_url: null,
  phone: "+15125550123", call_status: null, primary_offer: "build_website", website_url: "https://biz.com", contact_page_url: null,
  rating: 4.5, review_count: 10, address: null, website_review: null, ...over,
});
const row = (lead_id: string, over: Partial<SavedRow> = {}): SavedRow => ({
  job_id: "J1", lead_id, decision: "contact", offer: "website_build", channels: ["email", "form", "call"],
  allowed_offers: ["website_build", "ai_receptionist", "ai_booking"], allowed_channels: ["email", "form", "call"], reason: "r", source: "ai", approved: true, ...over,
});
const job = (over: Partial<BrainJob> = {}): BrainJob => ({
  id: "J1", command: "Get me 100 plumbers in Texas and work them", intent: "find_and_work", status: "review",
  ask: { intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 3, batchHint: null, missing: null },
  settings: DEFAULT_SETTINGS, batch_id: "B1", email_campaign_id: null, spent_usd: 1, notice: null, approved_at: null, created_at: "", updated_at: "", ...over,
});
const pick = (leadId: string, over: Partial<PlanPick> = {}): PlanPick => ({ leadId, approved: true, channels: ["email", "form", "call"], offer: "website_build", ...over });

function deps(leads: JudgeLead[], rows: SavedRow[], over: Partial<ApproveDeps> = {}) {
  const saved = new Map<string, Record<string, unknown>>();
  const d: ApproveDeps = {
    now: () => NOW,
    getJob: vi.fn(async () => job()),
    updateJob: vi.fn(async () => true),
    rows: vi.fn(async () => rows),
    loadLeads: vi.fn(async () => leads),
    context: vi.fn(async () => ({ emailed: new Set<string>(), triedForm: new Set<string>(), inOtherJob: new Set<string>(), callOffers: ["website_build", "ai_receptionist"] })),
    window: vi.fn(async () => ({ tz: "America/Chicago", days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 })),
    startEmails: vi.fn(async (_b, o) => ({ campaignId: "C1", slots: Object.fromEntries(Object.keys(o.only).map((id) => [id, "2026-11-27T16:10:00.000Z"])) })),
    stopCampaign: vi.fn(async () => {}),
    saveRow: vi.fn(async (_job, leadId, patch) => void saved.set(leadId, patch)),
    testMode: async () => ({ on: false, emails: [], phones: [], hosts: [] }),
    ...over,
  };
  return { d, saved };
}

describe("approvePlan", () => {
  it("starts the emails for the ticked leads and gives each its day 0 and its call day", async () => {
    const { d, saved } = deps([lead("A"), lead("B")], [row("A"), row("B")]);
    const r = await approvePlan("J1", [pick("A"), pick("B", { approved: false })], d);
    expect(r).toMatchObject({ ok: true, emails: 1, forms: 1, calls: 1 });
    expect(d.startEmails).toHaveBeenCalledWith("B1", expect.objectContaining({ only: { A: "website_build" }, dailyLimit: 10, followUps: 0, includeEu: false, name: "Brain · Get me 100 plumbers in Texas and work them" }));
    expect(saved.get("A")).toMatchObject({ approved: true, offer: "website_build", channels: ["email", "form", "call"], first_touch_at: "2026-11-27T16:10:00.000Z", call_due_at: "2026-11-29T16:10:00.000Z", form_state: "pending", call_state: "pending" });
    expect(saved.get("B")).toMatchObject({ approved: false });
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ email_campaign_id: "C1", approved_at: expect.any(String) }), ["running"]);
  });

  it("can only be approved once (a second click, a second tab)", async () => {
    const { d } = deps([lead("A")], [row("A")], { updateJob: vi.fn(async () => false) });
    const r = await approvePlan("J1", [pick("A")], d);
    expect(r).toEqual({ ok: false, message: "This plan was already approved or cancelled." });
    expect(d.startEmails).not.toHaveBeenCalled();
    expect(d.saveRow).not.toHaveBeenCalled();
  });

  it("never widens the plan: a channel or offer the row didn't allow is dropped", async () => {
    const { d, saved } = deps([lead("A")], [row("A", { allowed_channels: ["email"], channels: ["email"] })]);
    await approvePlan("J1", [pick("A", { channels: ["email", "call"], offer: "seo" })], d);
    expect(saved.get("A")).toMatchObject({ channels: ["email"], offer: "website_build", call_due_at: null, call_state: null, form_state: null });
  });

  it("a lead that unsubscribed or replied since the plan is not contacted", async () => {
    const { d, saved } = deps([lead("A", { lifecycle_stage: "unsubscribed" }), lead("B", { stage: "replied" }), lead("C")], [row("A"), row("B"), row("C")]);
    const r = await approvePlan("J1", [pick("A"), pick("B"), pick("C")], d);
    expect(r).toMatchObject({ ok: true, emails: 1 });
    expect((d.startEmails as ReturnType<typeof vi.fn>).mock.calls[0][1].only).toEqual({ C: "website_build" });
    expect(saved.get("A")).toMatchObject({ approved: false, outcome: "stopped" });
    expect(saved.get("B")).toMatchObject({ approved: false, outcome: "stopped" });
  });

  it("a ticked call needs a Voizo script for the offer picked", async () => {
    const { d, saved } = deps([lead("A")], [row("A")]);
    await approvePlan("J1", [pick("A", { offer: "ai_booking" })], d);
    expect(saved.get("A")).toMatchObject({ offer: "ai_booking", channels: ["email", "form"], call_state: null });
  });

  it("a lead the email campaign couldn't take keeps its other channels", async () => {
    const { d, saved } = deps([lead("A")], [row("A")], { startEmails: vi.fn(async () => ({ campaignId: "C1", slots: {} })) });
    await approvePlan("J1", [pick("A")], d);
    expect(saved.get("A")).toMatchObject({ approved: true, channels: ["form", "call"] });
    expect(typeof saved.get("A")!.first_touch_at).toBe("string");
  });

  it("with no email ticked it starts no email campaign", async () => {
    const { d, saved } = deps([lead("A")], [row("A")]);
    const r = await approvePlan("J1", [pick("A", { channels: ["form"] })], d);
    expect(d.startEmails).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, emails: 0, forms: 1, calls: 0 });
    expect(saved.get("A")).toMatchObject({ channels: ["form"], form_state: "pending" });
  });

  it("saves the campaign on the job as soon as it exists (so a Cancel during the set-up can stop its emails)", async () => {
    const { d } = deps([lead("A")], [row("A")]);
    await approvePlan("J1", [pick("A")], d);
    const calls = (d.updateJob as ReturnType<typeof vi.fn>).mock.calls;
    const i = calls.findIndex((c) => c[1].email_campaign_id === "C1");
    expect(calls[i][2]).toEqual(["running"]);
    expect((d.saveRow as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeGreaterThan((d.updateJob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[i]);
  });

  it("a job cancelled while it was being approved stays cancelled: its emails are stopped and nothing is scheduled", async () => {
    // The claim (review → running) works; every later conditional write finds the job no longer running.
    let n = 0;
    const { d } = deps([lead("A")], [row("A")], { updateJob: vi.fn(async (_id, _patch, onlyIf) => (onlyIf ? n++ === 0 : true)) });
    const r = await approvePlan("J1", [pick("A")], d);
    expect(r).toMatchObject({ ok: false });
    expect(d.stopCampaign).toHaveBeenCalledWith("C1");
    expect(d.saveRow).not.toHaveBeenCalled();
    // Never written back to "review" unconditionally.
    for (const c of (d.updateJob as ReturnType<typeof vi.fn>).mock.calls) if (c[1].status === "review") expect(c[2]).toEqual(["running"]);
  });

  it("Test mode: a ticked lead that isn't a test contact stops the approval, and nothing starts", async () => {
    const tm = { on: true, emails: ["a@biz.com"], phones: ["+15125550123"], hosts: ["biz.com"] };
    const { d } = deps([lead("A"), lead("B")], [row("A"), row("B")], { testMode: async () => tm });
    const r = await approvePlan("J1", [pick("A"), pick("B")], d);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/^Test mode is on: 1 ticked lead isn't a test contact \(Biz B\)/);
    expect(d.startEmails).not.toHaveBeenCalled();
    expect(d.saveRow).not.toHaveBeenCalled();
    // The same plan with only the test lead goes through.
    const ok = deps([lead("A"), lead("B")], [row("A"), row("B")], { testMode: async () => tm });
    expect(await approvePlan("J1", [pick("A"), pick("B", { approved: false })], ok.d)).toMatchObject({ ok: true });
  });

  it("refuses when nothing is ticked, and leaves the plan in review", async () => {
    const { d } = deps([lead("A")], [row("A")]);
    const r = await approvePlan("J1", [pick("A", { approved: false })], d);
    expect(r).toMatchObject({ ok: false });
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ status: "review" }), ["running"]);
  });

  it("if starting fails, nothing is left running: the plan goes back to review with the reason", async () => {
    const { d } = deps([lead("A")], [row("A")], { saveRow: vi.fn(async () => { throw new Error("db down"); }) });
    const r = await approvePlan("J1", [pick("A")], d);
    expect(r).toMatchObject({ ok: false });
    expect(d.stopCampaign).toHaveBeenCalledWith("C1");
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ status: "review", notice: expect.stringMatching(/Couldn't start/) }), ["running"]);
  });
});
