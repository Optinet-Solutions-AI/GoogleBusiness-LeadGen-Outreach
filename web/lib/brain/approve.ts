/**
 * brain/approve.ts — the operator approved the plan: start the emails and give each lead its schedule.
 *
 * Inputs:  job id + the ticks from the plan table (lead, approved, channels, offer); the plan rows with their allowed
 *          lists; today's facts about each lead (lib/brain/judge.ts); the batch-email starter
 * Outputs: an email campaign for the ticked leads with ✉ (lib/campaigns/batch-email-plan.ts startBatchEmail `only`);
 *          brain_job_leads rows with approved / offer / channels / first_touch_at / call_due_at / form_state /
 *          call_state; the job "running" with its campaign id — or back in "review" with the reason
 * Used by: app/api/brain/jobs/[id]/approve/route.ts
 *
 * Once only (review → running is one conditional update). Never wider than the plan: a tick is kept only for a channel
 * and an offer the row allowed AND that today's facts still allow, so a lead that replied or unsubscribed since the
 * plan is not contacted. Contact forms and calls are not sent here: lib/brain/runner.ts does them when they are due.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { campaignTimezone } from "@/lib/call-hours";
import type { SendWindow } from "@/lib/campaigns/send-window";
import { BatchEmailError, startBatchEmail } from "@/lib/campaigns/batch-email-plan";
import { setCampaignStatus } from "@/lib/campaigns/campaign-status";
import type { ServiceKey } from "@/lib/email/service-templates";
import { getJob, updateJob, type BrainJob } from "./jobs";
import { leadFacts, type FactsContext, type JudgeLead } from "./judge";
import { loadFactsContext, loadJobLeads, type SavedRow } from "./plan";
import { CHANNELS, allowedMoves, type Channel, type JobSettings, type JobStatus } from "./rules";
import { scheduleTouches } from "./schedule";

const log = getLogger("brain-approve");

export interface Pick {
  leadId: string;
  approved: boolean;
  channels: Channel[];
  offer: string | null;
}

export interface ApproveDeps {
  now: () => number;
  getJob: (id: string) => Promise<BrainJob | null>;
  updateJob: (id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]) => Promise<boolean>;
  rows: (jobId: string) => Promise<SavedRow[]>;
  loadLeads: (batchId: string) => Promise<JudgeLead[]>;
  context: (leadIds: string[], jobId: string) => Promise<FactsContext>;
  /** Mon–Fri 9–17 in the batch's time. */
  window: (batchId: string) => Promise<SendWindow>;
  startEmails: (
    batchId: string,
    o: { only: Record<string, ServiceKey>; dailyLimit: number; followUps: JobSettings["followUps"]; includeEu: boolean; name: string },
  ) => Promise<{ campaignId: string; slots: Record<string, string> }>;
  /** No more emails from this campaign. */
  stopCampaign: (campaignId: string) => Promise<void>;
  saveRow: (jobId: string, leadId: string, patch: Record<string, unknown>) => Promise<void>;
}

/** The batch's sending window: Mon–Fri 9–17 in its country's time (as batch emails). */
export async function batchWindow(batchId: string): Promise<SendWindow> {
  const { data } = await getDb().from("batches").select("country_code").eq("id", batchId).maybeSingle();
  return { tz: campaignTimezone((data as { country_code: string | null } | null)?.country_code ?? "us"), days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };
}

const defaultDeps: ApproveDeps = {
  now: () => Date.now(),
  getJob,
  updateJob,
  rows: async (jobId) => {
    const { data, error } = await getDb().from("brain_job_leads").select("job_id,lead_id,decision,offer,channels,allowed_offers,allowed_channels,reason,source,approved").eq("job_id", jobId).limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as SavedRow[];
  },
  loadLeads: loadJobLeads,
  context: loadFactsContext,
  window: batchWindow,
  startEmails: async (batchId, o) => {
    const r = await startBatchEmail(batchId, { ...o, choices: {} });
    return { campaignId: r.campaignId, slots: r.slots };
  },
  stopCampaign: async (campaignId) => {
    await setCampaignStatus(campaignId, "done");
  },
  saveRow: async (jobId, leadId, patch) => {
    const { error } = await getDb().from("brain_job_leads").update({ ...patch, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("lead_id", leadId);
    if (error) throw new Error(error.message);
  },
};

type Final = { leadId: string; offer: ServiceKey; channels: Channel[] };

export async function approvePlan(
  jobId: string,
  picks: Pick[],
  deps: ApproveDeps = defaultDeps,
): Promise<{ ok: true; emails: number; forms: number; calls: number; days: number } | { ok: false; message: string }> {
  // 1. Once only: a second click or a second tab finds the job no longer in review.
  if (!(await deps.updateJob(jobId, { status: "running" }, ["review"]))) return { ok: false, message: "This plan was already approved or cancelled." };
  let campaignId: string | null = null;
  const backToReview = async (notice: string) => {
    if (campaignId) await deps.stopCampaign(campaignId).catch((e) => log.error({ job_id: jobId, campaign_id: campaignId, err: String(e) }, "brain.approve_stop_campaign_failed"));
    await deps.updateJob(jobId, { status: "review", notice, email_campaign_id: null });
    return { ok: false as const, message: notice };
  };
  try {
    const job = await deps.getJob(jobId);
    if (!job?.batch_id) return await backToReview("This job has no batch to work.");
    const [rows, leads] = await Promise.all([deps.rows(jobId), deps.loadLeads(job.batch_id)]);
    const ctx = await deps.context(leads.map((l) => l.id), jobId);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const pickById = new Map(picks.map((p) => [p.leadId, p]));

    // 2 + 3. Each tick against what the plan allowed AND what today's facts allow.
    const finals: Final[] = [];
    const dropped: { leadId: string; reason: string | null }[] = [];
    for (const row of rows) {
      const p = pickById.get(row.lead_id);
      if (!p?.approved) {
        dropped.push({ leadId: row.lead_id, reason: null });
        continue;
      }
      const lead = leadById.get(row.lead_id);
      const facts = lead ? leadFacts(lead, job.settings, ctx) : null;
      const today = facts ? allowedMoves(facts, job.settings) : null;
      if (!facts || !today || today.skip) {
        dropped.push({ leadId: row.lead_id, reason: today?.skip ?? "This lead is no longer in the batch" });
        continue;
      }
      const offer = ((p.offer && row.allowed_offers.includes(p.offer) ? p.offer : null) ?? row.offer ?? row.allowed_offers[0]) as ServiceKey | undefined;
      const channels = CHANNELS.filter(
        (c) => p.channels.includes(c) && row.allowed_channels.includes(c) && today.channels.includes(c) && (c !== "call" || (!!offer && facts.callOffers.includes(offer))),
      );
      if (!offer || !(today.offers as string[]).includes(offer) || !channels.length) {
        dropped.push({ leadId: row.lead_id, reason: "It can no longer be reached the way the plan said" });
        continue;
      }
      finals.push({ leadId: row.lead_id, offer, channels });
    }
    if (!finals.length) return await backToReview("Nothing was ticked that can still be contacted. Tick at least one lead.");

    // 4. The emails: one campaign for the leads with ✉ (the existing batch-email machinery sends them).
    let slots: Record<string, string> = {};
    const emailLeads = finals.filter((f) => f.channels.includes("email"));
    if (emailLeads.length) {
      const started = await deps.startEmails(job.batch_id, {
        only: Object.fromEntries(emailLeads.map((f) => [f.leadId, f.offer])),
        dailyLimit: job.settings.perDay.emails,
        followUps: job.settings.followUps,
        includeEu: job.settings.includeEu,
        name: `Brain · ${job.command.slice(0, 60)}`,
      });
      campaignId = started.campaignId;
      slots = started.slots;
      // A lead the campaign couldn't take (it started other emails since the plan) keeps its other channels.
      for (const f of emailLeads) if (!slots[f.leadId]) f.channels = f.channels.filter((c) => c !== "email");
    }
    const going = finals.filter((f) => f.channels.length);
    for (const f of finals) if (!f.channels.length) dropped.push({ leadId: f.leadId, reason: "It started getting other emails since the plan" });
    if (!going.length) return await backToReview("None of the ticked leads could be started (they may be getting other emails already).");

    // 5. Day 0 and the call day for each lead.
    const times = scheduleTouches({
      rows: going.map((f) => ({ lead_id: f.leadId, channels: f.channels })),
      emailSlots: slots,
      window: await deps.window(job.batch_id),
      formsPerDay: job.settings.perDay.forms,
      now: new Date(deps.now()),
    });
    for (const f of going) {
      await deps.saveRow(jobId, f.leadId, {
        approved: true,
        decision: "contact",
        offer: f.offer,
        channels: f.channels,
        first_touch_at: times[f.leadId].first_touch_at,
        call_due_at: times[f.leadId].call_due_at,
        form_state: f.channels.includes("form") ? "pending" : null,
        call_state: f.channels.includes("call") ? "pending" : null,
        outcome: null,
        outcome_reason: null,
      });
    }
    for (const d of dropped) {
      await deps.saveRow(jobId, d.leadId, d.reason ? { approved: false, outcome: "stopped", outcome_reason: d.reason } : { approved: false });
    }
    await deps.updateJob(jobId, { email_campaign_id: campaignId, approved_at: new Date(deps.now()).toISOString(), notice: null });

    const count = (c: Channel) => going.filter((f) => f.channels.includes(c)).length;
    const last = Math.max(...going.map((f) => Date.parse(times[f.leadId].first_touch_at)));
    const days = Math.max(1, Math.ceil((last - deps.now()) / 86_400_000));
    log.info({ job_id: jobId, campaign_id: campaignId, leads: going.length, emails: count("email"), forms: count("form"), calls: count("call") }, "brain.approved");
    return { ok: true, emails: count("email"), forms: count("form"), calls: count("call"), days };
  } catch (err) {
    log.error({ job_id: jobId, err: String(err) }, "brain.approve_failed");
    const why = err instanceof BatchEmailError ? err.message : "something went wrong on our side";
    return await backToReview(`Couldn't start: ${why}. Nothing is running; approve again when it's fixed.`);
  }
}
