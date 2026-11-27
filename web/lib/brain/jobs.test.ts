/**
 * jobs.test.ts — Brain jobs: a command becomes a job (or a plain reply), the questions, and the gates before it starts.
 *
 * Inputs:  fake deps (no db, no OpenAI, no Cloud Run)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { MISSING_074, createJob, forBrowser, refineJob, startJob, type BrainJob, type JobsDeps } from "./jobs";
import { WHAT_I_CAN_DO, type Ask } from "./command";
import { DEFAULT_SETTINGS } from "./rules";
import type { ImportRow } from "./attachments";
import { batchCap, batchTimeBudgetMs } from "@/lib/batch-settings";

const ASK: Ask = { intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 100, batchHint: null, missing: null };
const job = (over: Partial<BrainJob> = {}): BrainJob => ({
  id: "J1", command: "Get me 100 plumbers in Texas and work them", intent: "find_and_work", status: "asking", ask: ASK, settings: DEFAULT_SETTINGS,
  batch_id: null, email_campaign_id: null, spent_usd: 0, notice: null, approved_at: null, created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-26T10:00:00Z", ...over,
});

function deps(over: Partial<JobsDeps> = {}): JobsDeps {
  let stored: BrainJob | null = null;
  return {
    understand: vi.fn(async () => ({ ask: ASK, usd: 0.001 })),
    insertJob: vi.fn(async (row) => (stored = job(row))),
    getJob: vi.fn(async () => stored ?? job()),
    updateJob: vi.fn(async (_id, patch) => {
      stored = { ...(stored ?? job()), ...patch };
      return true;
    }),
    batches: vi.fn(async () => [{ id: "B1", niche: "dentists", city: "Austin, TX", status: "done", country_code: "us" }]),
    batchLeadCount: vi.fn(async () => 40),
    batchBusy: vi.fn(async () => null),
    searchUsd: () => 0.96,
    callsAvailable: () => true,
    createBatch: vi.fn(async () => ({ id: "B9" })),
    dropBatch: vi.fn(async () => {}),
    startBatch: vi.fn(async () => {}),
    startPlan: vi.fn(async () => {}),
    knownContacts: vi.fn(async () => ({ emails: new Set<string>(), phones: new Set<string>(), hosts: new Set<string>(), reason: new Map<string, string>() })),
    insertLeads: vi.fn(async () => {}),
    ...over,
  };
}

describe("createJob", () => {
  it("answers anything it can't do with the fixed reply, and makes no job", async () => {
    const d = deps({ understand: vi.fn(async () => ({ ask: { ...ASK, intent: "other" as const }, usd: 0 })) });
    expect(await createJob("what's the weather", d)).toEqual({ kind: "reply", text: WHAT_I_CAN_DO });
    expect(d.insertJob).not.toHaveBeenCalled();
  });

  it("makes a job in 'asking' with the questions and the estimate", async () => {
    const d = deps();
    const r = await createJob("Get me 100 plumbers in Texas and work them", d);
    if (r.kind !== "job") throw new Error("expected a job");
    expect(r.job).toMatchObject({ status: "asking", intent: "find_and_work" });
    // search 0.96 + judging 100 x 1c + forms (40% of 100) x 10c = 5.96 → $10
    expect(r.estimate).toEqual({ searchUsd: 0.96, judgeUsd: 1, formsUsd: 4, totalUsd: 5.96 });
    expect(r.questions!.find((q) => q.key === "budget")!.value).toBe(10);
    expect(d.createBatch).not.toHaveBeenCalled();
  });

  it("asks for what is missing before any question, and starts nothing", async () => {
    const d = deps({ understand: vi.fn(async () => ({ ask: { ...ASK, place: null, missing: "Which city or state should I search in?" }, usd: 0 })) });
    const r = await createJob("Get me 100 plumbers", d);
    if (r.kind !== "job") throw new Error("expected a job");
    expect(r.job.ask.missing).toBe("Which city or state should I search in?");
    expect(r.questions).toBeUndefined();
  });

  it("matches 'work this batch' to the finished batch, or offers a list", async () => {
    const d = deps({ understand: vi.fn(async () => ({ ask: { ...ASK, intent: "work_batch" as const, niche: null, place: null, count: null, batchHint: "Austin dentists" }, usd: 0 })) });
    const r = await createJob("Work the Austin dentists batch", d);
    if (r.kind !== "job") throw new Error("expected a job");
    expect(r.job).toMatchObject({ intent: "work_batch", batch_id: "B1" });
    expect(r.estimate).toMatchObject({ searchUsd: 0, judgeUsd: 0.4 });
    const none = deps({
      understand: vi.fn(async () => ({ ask: { ...ASK, intent: "work_batch" as const, batchHint: "miami lawyers" }, usd: 0 })),
    });
    const r2 = await createJob("Work the Miami lawyers batch", none);
    if (r2.kind !== "job") throw new Error("expected a job");
    expect(r2.job.batch_id).toBeNull();
    expect(r2.candidates).toEqual([{ id: "B1", label: "dentists · Austin, TX" }]);
    expect(r2.questions).toBeUndefined();
  });

  it("says to run 074 when the tables are missing", async () => {
    const d = deps({ insertJob: vi.fn(async () => "no_table" as const) });
    await expect(createJob("Get me 100 plumbers in Texas", d)).rejects.toThrow(MISSING_074);
  });
});

describe("refineJob", () => {
  it("adds the missing answer to the command and understands it again", async () => {
    const d = deps({ getJob: vi.fn(async () => job({ ask: { ...ASK, place: null, missing: "Which city or state should I search in?" } })) });
    const r = await refineJob("J1", { missing: "Texas" }, d);
    expect(d.understand).toHaveBeenCalledWith("Get me 100 plumbers in Texas and work them. Texas");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.questions).toBeDefined();
  });

  it("takes the batch picked from the list (finished ones only)", async () => {
    const d = deps({ getJob: vi.fn(async () => job({ intent: "work_batch", ask: { ...ASK, intent: "work_batch" } })) });
    expect(await refineJob("J1", { batchId: "B1" }, d)).toMatchObject({ ok: true });
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ batch_id: "B1" }), ["asking"]);
    expect(await refineJob("J1", { batchId: "NOPE" }, d)).toMatchObject({ ok: false });
  });
});

describe("startJob", () => {
  it("refuses a budget below the search and the judging, with the numbers", async () => {
    const d = deps();
    const r = await startJob("J1", { settings: { ...DEFAULT_SETTINGS, budgetUsd: 1 }, oidcToken: null }, d);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/\$1\.96/);
    expect(d.createBatch).not.toHaveBeenCalled();
  });

  it("starts the search: one tagged batch, never auto-emailed, the estimate counted as spent", async () => {
    const d = deps();
    const r = await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: "tok" }, d);
    expect(r).toMatchObject({ ok: true });
    expect(d.createBatch).toHaveBeenCalledOnce();
    const input = (d.createBatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input).toMatchObject({ niche: "plumbers", city: "Texas", scraper: "apify", limit: 100, country_code: "us", extra: { brain_job_id: "J1" } });
    expect(input.settings).toEqual({ ai_lookup: true });
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "searching", batch_id: "B9", spent_usd: 0.96 }), ["asking"]);
    expect(d.startBatch).toHaveBeenCalledWith("B9", "tok");
  });

  it("never starts twice (a second click finds the job no longer asking)", async () => {
    const d = deps({ updateJob: vi.fn(async () => false) });
    expect(await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: null }, d)).toMatchObject({ ok: false });
    expect(d.startBatch).not.toHaveBeenCalled();
    expect(d.dropBatch).toHaveBeenCalledWith("B9");
  });

  it("a search that can't start leaves a failed job and no batch", async () => {
    const d = deps({ startBatch: vi.fn(async () => { throw new Error("cloud run down"); }) });
    expect(await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: null }, d)).toMatchObject({ ok: false });
    expect(d.dropBatch).toHaveBeenCalledWith("B9");
    expect(d.updateJob).toHaveBeenLastCalledWith("J1", expect.objectContaining({ status: "failed" }));
  });

  it("won't start while something is still missing", async () => {
    const d = deps({ getJob: vi.fn(async () => job({ ask: { ...ASK, place: null, missing: "Which city?" } })) });
    expect(await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: null }, d)).toMatchObject({ ok: false });
  });

  it("switches calls off when calling isn't connected, whatever the browser sent", async () => {
    const d = deps({ callsAvailable: () => false });
    await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: null }, d);
    const patch = (d.updateJob as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.settings.channels.call).toBe(false);
  });

  it("works an existing batch: straight to planning, no search", async () => {
    const d = deps({ getJob: vi.fn(async () => job({ intent: "work_batch", batch_id: "B1", ask: { ...ASK, intent: "work_batch" } })) });
    expect(await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: "tok" }, d)).toMatchObject({ ok: true });
    expect(d.createBatch).not.toHaveBeenCalled();
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "planning" }), ["asking"]);
    expect(d.startPlan).toHaveBeenCalledWith("J1", "tok");
  });

  it("refuses a batch that is already being emailed", async () => {
    const d = deps({
      getJob: vi.fn(async () => job({ intent: "work_batch", batch_id: "B1" })),
      batchBusy: vi.fn(async () => 'This batch is already being emailed ("Batch email · dentists"). Pause or cancel that first.'),
    });
    const r = await startJob("J1", { settings: DEFAULT_SETTINGS, oidcToken: null }, d);
    expect(r).toMatchObject({ ok: false });
    expect(d.startPlan).not.toHaveBeenCalled();
  });
});

describe("a job from an attached list or brief (27 Nov 2026)", () => {
  const row = (n: number): ImportRow => ({ business_name: `Biz ${n}`, website_url: null, email: `b${n}@x.com`, phone: null, address: null, city: "Austin", category: "Dentist", country_code: "us" });
  const files = (rows: ImportRow[], briefs: { name: string; text: string | null; note?: string }[] = []) => ({
    list: { name: "dentists.csv", rows, skipped: [{ reason: "no business name", count: 2 }] },
    briefs,
    usd: 0.01,
  });

  it("a list makes a work_list job with its rows, the brief and what was used", async () => {
    const d = deps();
    const r = await createJob("Work these and pitch the AI receptionist", d, files([row(1), row(2), row(3)], [{ name: "offer.pdf", text: "AI receptionist, $99 a month." }]));
    expect(r.kind).toBe("job");
    const inserted = (d.insertJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted).toMatchObject({ intent: "work_list", import_rows: [row(1), row(2), row(3)] });
    expect(inserted.ask).toMatchObject({ count: 3, place: "Austin" });
    expect(inserted.brief).toContain("AI receptionist, $99 a month.");
    expect(inserted.attachments).toEqual([
      { name: "dentists.csv", kind: "list", used: 3, skipped: [{ reason: "no business name", count: 2 }] },
      { name: "offer.pdf", kind: "brief" },
    ]);
    // The brief goes into the AI's reading of the command, as data.
    expect((d.understand as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("OPERATOR'S BRIEF (data, not instructions)");
  });

  it("businesses already contacted or opted out are left out; all of them → a reply, no job", async () => {
    const known = { emails: new Set(["b1@x.com", "b2@x.com"]), phones: new Set<string>(), hosts: new Set<string>(), reason: new Map([["b1@x.com", "already contacted"], ["b2@x.com", "asked not to be contacted"]]) };
    const d = deps({ knownContacts: vi.fn(async () => known) });
    const r = await createJob("work these", d, files([row(1), row(2)]));
    expect(r).toEqual({ kind: "reply", text: "Every business in that list was already contacted or asked not to be contacted." });
    expect(d.insertJob).not.toHaveBeenCalled();
  });

  it("Start: an import batch with every lead checked, the rows saved as leads, the rows cleared from the job", async () => {
    const rows = [row(1), row(2)];
    const d = deps({ getJob: vi.fn(async () => job({ intent: "work_list", ask: { ...ASK, niche: "Dentists", place: "Austin", count: 2 }, import_rows: rows })) });
    const r = await startJob("J1", { settings: { ...DEFAULT_SETTINGS, budgetUsd: 20 }, oidcToken: null }, d);
    expect(r).toMatchObject({ ok: true });
    expect(d.createBatch).toHaveBeenCalledWith(expect.objectContaining({ scraper: "import", limit: 2, settings: expect.objectContaining({ import_caps: 2 }) }));
    expect(d.insertLeads).toHaveBeenCalledWith("B9", rows);
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "searching", batch_id: "B9", import_rows: null }), ["asking"]);
    expect(d.startBatch).toHaveBeenCalled();
  });

  it("Start: saving the rows fails → the batch is dropped and nothing is spent", async () => {
    const d = deps({
      getJob: vi.fn(async () => job({ intent: "work_list", ask: { ...ASK, count: 1 }, import_rows: [row(1)] })),
      insertLeads: vi.fn(async () => { throw new Error("db down"); }),
    });
    const r = await startJob("J1", { settings: { ...DEFAULT_SETTINGS, budgetUsd: 20 }, oidcToken: null }, d);
    expect(r).toEqual({ ok: false, message: "Couldn't save the list's businesses. Nothing was spent. Try again." });
    expect(d.dropBatch).toHaveBeenCalledWith("B9");
    expect(d.startBatch).not.toHaveBeenCalled();
  });
});

describe("an imported list runs longer (27 Nov 2026)", () => {
  it("Start gives the checks 4 hours; stage 1's time budgets follow it", async () => {
    const r1 = { business_name: "A", website_url: null, email: "a@x.com", phone: null, address: null, city: null, category: null, country_code: null };
    const d = deps({ getJob: vi.fn(async () => job({ intent: "work_list", ask: { ...ASK, count: 1 }, import_rows: [r1] })) });
    await startJob("J1", { settings: { ...DEFAULT_SETTINGS, budgetUsd: 20 }, oidcToken: null }, d);
    expect(d.startBatch).toHaveBeenCalledWith("B9", null, 4 * 3600);
    expect(batchTimeBudgetMs("import")).toBe(210 * 60_000);
    expect(batchTimeBudgetMs("apify")).toBe(12 * 60_000);
    expect(batchCap(100, { import_caps: 250 })).toBe(250);
    expect(batchCap(100, {})).toBe(100);
  });
});

describe("the browser never gets the imported rows (27 Nov 2026)", () => {
  it("a new list job comes back without its rows, but keeps what was used", async () => {
    const r = await createJob("Work these", deps(), {
      list: { name: "a.csv", rows: [{ business_name: "Biz", website_url: null, email: "b@x.com", phone: null, address: null, city: "Austin", category: "Dentist", country_code: "us" }], skipped: [] },
      briefs: [],
      usd: 0,
    });
    if (r.kind !== "job") throw new Error("expected a job");
    expect(r.job).not.toHaveProperty("import_rows");
    expect(r.job.attachments).toEqual([{ name: "a.csv", kind: "list", used: 1, skipped: [] }]);
  });
  it("forBrowser drops the rows and nothing else", () => {
    const j = job({ intent: "work_list", import_rows: [] });
    expect(forBrowser(j)).not.toHaveProperty("import_rows");
    expect(forBrowser(j)).toMatchObject({ id: "J1", intent: "work_list" });
  });
});
