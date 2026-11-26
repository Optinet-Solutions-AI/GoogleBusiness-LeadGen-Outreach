/**
 * plan.test.ts — the Brain's plan: the AI's answer is kept only inside the allowed lists, and the plan still gets
 * built when the AI is down, the budget runs out, or there is nobody to contact.
 *
 * Inputs:  fake deps (no db, no OpenAI)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { buildPlan, planJobForBatch, type PlanDeps, type SavedRow } from "./plan";
import type { JudgeLead } from "./judge";
import type { BrainJob } from "./jobs";
import { DEFAULT_SETTINGS } from "./rules";

const lead = (id: string, over: Partial<JudgeLead> = {}): JudgeLead => ({
  id, business_name: `Biz ${id}`, email: `${id}@biz.com`, verification_status: "valid", qualified: true, lifecycle_stage: "prospect",
  stage: "scraped", seq_status: "none", country_code: "us", call_segment: "no_website", website_kind: null, has_website: false, needs_improvement: null,
  signal_type: null, signal_meta: null, contact_owner_name: null, category: "Plumber", demo_url: null,
  phone: "+15125550123", call_status: null, primary_offer: "build_website", website_url: "https://biz.com", contact_page_url: null,
  rating: 4.5, review_count: 10, address: null, website_review: null, ...over,
});
const job = (over: Partial<BrainJob> = {}): BrainJob => ({
  id: "J1", command: "x", intent: "find_and_work", status: "searching", ask: { intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 3, batchHint: null, missing: null },
  settings: DEFAULT_SETTINGS, batch_id: "B1", email_campaign_id: null, spent_usd: 0.5, notice: null, approved_at: null, created_at: "", updated_at: "", ...over,
});

function deps(leads: JudgeLead[], over: Partial<PlanDeps> = {}) {
  const saved: SavedRow[] = [];
  const d: PlanDeps = {
    getJob: vi.fn(async () => job()),
    updateJob: vi.fn(async () => true),
    addSpend: vi.fn(async () => 0),
    jobForBatch: vi.fn(async () => job()),
    loadLeads: vi.fn(async () => leads),
    batchCity: vi.fn(async () => "Texas"),
    context: vi.fn(async () => ({ emailed: new Set<string>(), triedForm: new Set<string>(), inOtherJob: new Set<string>(), callOffers: ["website_build"] })),
    configured: () => true,
    judge: vi.fn(async () => ({ data: { contact: true, offer: "ai_receptionist", channels: ["email"], reason: "Busy shop." }, usd: 0.004 })),
    saveRows: vi.fn(async (_id, rows) => void saved.push(...rows)),
    ...over,
  };
  return { d, saved };
}

describe("buildPlan", () => {
  it("keeps the AI's answer when it stays inside the lists, and saves one row per lead", async () => {
    const { d, saved } = deps([lead("A"), lead("B")]);
    const r = await buildPlan("J1", d);
    expect(r).toMatchObject({ rows: 2, contact: 2 });
    expect(saved[0]).toMatchObject({ job_id: "J1", lead_id: "A", decision: "contact", offer: "ai_receptionist", channels: ["email"], source: "ai", approved: true, reason: "Busy shop." });
    expect(saved[0].allowed_offers).toEqual(["website_build", "ai_receptionist", "ai_booking"]);
    expect(saved[0].allowed_channels).toEqual(["email", "form", "call"]);
    expect(d.addSpend).toHaveBeenCalledWith("J1", 0.008);
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ status: "review", notice: null }), ["planning"]);
  });

  it("replaces an answer that leaves the lists with the standard rule", async () => {
    const { d, saved } = deps([lead("A")], { judge: vi.fn(async () => ({ data: { contact: true, offer: "seo", channels: ["email"], reason: "x" }, usd: 0.004 })) });
    await buildPlan("J1", d);
    expect(saved[0]).toMatchObject({ offer: "website_build", channels: ["email", "form", "call"], source: "default" });
  });

  it("doesn't ask the AI about a lead the code already skips", async () => {
    const { d, saved } = deps([lead("A", { stage: "replied" }), lead("B")]);
    await buildPlan("J1", d);
    expect(d.judge).toHaveBeenCalledTimes(1);
    expect(saved.find((r) => r.lead_id === "A")).toMatchObject({ decision: "skip", source: "rule", approved: false, channels: [] });
  });

  it("still builds the plan from the rules when the AI is off, and says so", async () => {
    const { d, saved } = deps([lead("A"), lead("B")], { configured: () => false });
    await buildPlan("J1", d);
    expect(d.judge).not.toHaveBeenCalled();
    expect(saved.every((r) => r.source === "default" && r.decision === "contact")).toBe(true);
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ status: "review", notice: "AI wasn't available, so this plan uses the standard rules." }), ["planning"]);
  });

  it("stops asking after the AI fails three times in a row from the start", async () => {
    const judge = vi.fn(async () => { throw new Error("openai 500"); });
    const { d, saved } = deps(Array.from({ length: 12 }, (_, i) => lead(`L${i}`)), { judge });
    await buildPlan("J1", d);
    expect(judge.mock.calls.length).toBeLessThanOrEqual(7); // 3 failures + the few already in flight
    expect(saved).toHaveLength(12);
    expect(saved.every((r) => r.source === "default")).toBe(true);
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ notice: "AI wasn't available, so this plan uses the standard rules." }), ["planning"]);
  });

  it("one failed answer is just that lead on the standard rule", async () => {
    let n = 0;
    const judge = vi.fn(async () => {
      if (n++ === 1) throw new Error("timeout");
      return { data: { contact: true, offer: "website_build", channels: ["email"], reason: "ok" }, usd: 0.004 };
    });
    const { d, saved } = deps([lead("A"), lead("B"), lead("C")], { judge });
    await buildPlan("J1", d);
    expect(saved.filter((r) => r.source === "ai")).toHaveLength(2);
    expect(saved.filter((r) => r.source === "default")).toHaveLength(1);
  });

  it("never judges past the budget: the rest use the standard rule, and the plan says so", async () => {
    const { d, saved } = deps(Array.from({ length: 10 }, (_, i) => lead(`L${i}`)), {
      getJob: vi.fn(async () => job({ spent_usd: 0.97, settings: { ...DEFAULT_SETTINGS, budgetUsd: 1 } })),
    });
    await buildPlan("J1", d);
    // $0.03 left = room for 3 judgings at about 1 cent each.
    expect((d.judge as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(saved).toHaveLength(10);
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ notice: "The budget was reached while judging, so the rest of this plan uses the standard rules." }), ["planning"]);
  });

  it("with nobody to contact it still reaches review, and says why", async () => {
    const { d } = deps([lead("A", { stage: "replied" }), lead("B", { lifecycle_stage: "unsubscribed" })]);
    const r = await buildPlan("J1", d);
    expect(r.contact).toBe(0);
    const last = (d.updateJob as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(last[1].status).toBe("review");
    expect(last[1].notice).toMatch(/^Nothing to contact in this batch: /);
  });

  it("records what the judging cost even when saving the plan fails (so a retry can't spend it again unseen)", async () => {
    const { d } = deps([lead("A"), lead("B")], { saveRows: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(buildPlan("J1", d)).rejects.toThrow("db down");
    expect(d.addSpend).toHaveBeenCalledWith("J1", 0.008);
  });

  it("does nothing for a job that isn't searching or planning (a second run, an approved job)", async () => {
    const { d } = deps([lead("A")], { updateJob: vi.fn(async () => false) });
    expect(await buildPlan("J1", d)).toEqual({ rows: 0, contact: 0, usd: 0 });
    expect(d.loadLeads).not.toHaveBeenCalled();
    expect(d.saveRows).not.toHaveBeenCalled();
  });
});

describe("planJobForBatch (the hook at the end of a batch run)", () => {
  it("plans the job that started this batch", async () => {
    const { d } = deps([lead("A")]);
    await planJobForBatch("B1", "done", d);
    expect(d.saveRows).toHaveBeenCalled();
  });

  it("does nothing for an ordinary batch", async () => {
    const { d } = deps([lead("A")], { jobForBatch: vi.fn(async () => null) });
    await planJobForBatch("B1", "done", d);
    expect(d.loadLeads).not.toHaveBeenCalled();
  });

  it("a search that failed or was cancelled fails the job with a plain note; a paused one waits", async () => {
    const { d } = deps([lead("A")]);
    await planJobForBatch("B1", "failed", d);
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "failed" }), ["searching"]);
    expect(d.loadLeads).not.toHaveBeenCalled();
    const p = deps([lead("A")]);
    await planJobForBatch("B1", "paused", p.d);
    expect(p.d.updateJob).not.toHaveBeenCalled();
  });

  it("never throws into the batch run", async () => {
    const { d } = deps([lead("A")], { loadLeads: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(planJobForBatch("B1", "done", d)).resolves.toBeUndefined();
  });
});
