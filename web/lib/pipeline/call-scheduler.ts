/**
 * call-scheduler.ts — the Voizo call worker: dial due campaign members one at a time.
 *
 * Inputs:  active call_campaigns (channel 'call') + their campaign_leads; Voizo status/calls
 * Outputs: call_attempts rows, campaign_leads retry state, leads.call_status / inbox_status,
 *          outreach_events (call_placed / call_qualified / call_declined / …)
 * Used by: scripts/cloud-run-job.ts (MODE=call, fired every 15 min by Cloud Scheduler)
 *
 * One tick: reconcile unfinished calls → loop { Voizo ready? → claim next due member → dial →
 * poll until done → finalize } until the time budget runs low. Serial by design: Voizo allows one
 * live call. Finalize is idempotent (claims call_attempts.processed_at), so a result polled twice
 * never fires the handoff twice. Full rules: workflows/call_leads_voizo.md.
 * A test number typed in Call with AI (campaign_leads.call_phone, migration 060) is dialled instead of the
 * lead's phone for that queue entry; every other gate (country, do-not-call, Voizo shadow) still applies.
 */

import "@/lib/server-guard";
import { getDb } from "../db";
import { env } from "../config";
import { getLogger } from "../logger";
import { getStatus, placeCall, getCall, isVoizoConfigured, type VoizoCall } from "../services/voizo";
import { routeCallResult, classifyDialRefusal, agentRefusal, stageAfterCall, type CallRoute, type FinishedCall } from "../calls/route-result";
import { recordStageEvent } from "../lead-stage";
import { toE164 } from "../phone";
import { isMissingColumn } from "../db-errors";
import { isSuppressed, addSuppression } from "../suppression";
import { callCampaignOpen } from "../call-hours";
import { isNoCallCountry, noCallScript } from "../leads/contact-readiness";
import { agentNameFor, captureRecording, sweepRecordings } from "../calls/recording-capture";
import { dialAgentName } from "../calls/recordings";

const log = getLogger("call-scheduler");

const POLL_MS = 15_000;
const GIVE_UP_MS = 15 * 60_000; // Voizo: give up polling after 15 min → unknown
const MIN_LEFT_TO_DIAL_MS = 4 * 60_000; // don't start a call the tick can't watch for a while
const CLAIM_MINUTES = 30;

// GDPR gate: lib/leads/contact-readiness.ts isNoCallCountry (EU + EEA + UK + the all-of-Europe "eu").
/** Leads in these states are never dialled. */
const NO_CALL_LIFECYCLE = new Set(["dnc", "unsubscribed", "customer", "dead"]);
const NO_CALL_STATUS = new Set(["qualified", "not_interested", "bad_number", "dnc"]);
const OFFERS = new Set(["build_website", "improve_website", "voice_agent"]);

export interface CallTickSummary {
  configured: boolean;
  reconciled: number;
  dialed: number;
  finalized: number;
  skipped: number;
  /** Recordings copied from Vapi by the sweep at the start of the tick (lib/calls/recording-capture.ts). */
  recordings: number;
  stoppedBecause: string | null;
}

interface CampaignRow {
  id: string;
  name: string | null;
  timezone: string | null;
  country_code: string | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
}

interface LeadRow {
  id: string;
  phone: string | null;
  country_code: string | null;
  lifecycle_stage: string | null;
  call_status: string | null;
  primary_offer: string | null;
  /** Review-site leads are never dialled (noCallScript), even before their offer is saved. */
  signal_type?: string | null;
}

interface MemberRow {
  campaign_id: string;
  lead_id: string;
  call_attempts: number;
  leads: LeadRow | null;
}

interface AttemptRow {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  provider_call_id: string;
  created_at: string;
  meta: Record<string, unknown> | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoIn = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export async function runCallTick(opts: { budgetMs?: number; campaignId?: string } = {}): Promise<CallTickSummary> {
  const summary: CallTickSummary = {
    configured: isVoizoConfigured(), reconciled: 0, dialed: 0, finalized: 0, skipped: 0, recordings: 0, stoppedBecause: null,
  };
  // 0. Recordings not saved yet (not ready at call end, or a failed try): before every early exit, so they still
  //    arrive when nothing is dialled. Never throws; a no-op without VAPI_API_KEY.
  summary.recordings = await sweepRecordings();
  if (!summary.configured) {
    summary.stoppedBecause = "not_configured";
    return summary;
  }
  const deadline = Date.now() + (opts.budgetMs ?? env.CALL_TICK_BUDGET_MINUTES * 60_000);

  // 1. Finish whatever an earlier tick left ringing.
  const { data: open } = await getDb()
    .from("call_attempts")
    .select("id,lead_id,campaign_id,provider_call_id,created_at,meta")
    .eq("provider", "voizo")
    .is("processed_at", null)
    .not("provider_call_id", "is", null)
    .order("created_at", { ascending: true });
  for (const attempt of (open ?? []) as AttemptRow[]) {
    summary.reconciled += 1;
    if ((await watch(attempt, deadline)) === "finalized") summary.finalized += 1;
    else {
      summary.stoppedBecause = "call_still_live";
      return summary;
    }
  }

  // 2. Dial loop.
  while (Date.now() + MIN_LEFT_TO_DIAL_MS < deadline) {
    const status = await getStatus();
    if (!status.ok) {
      const action = classifyDialRefusal(status.code, status.status);
      if (action.kind === "abort") log.error({ code: status.code }, "call.tick.abort (Voizo status refused) — tell Chris");
      summary.stoppedBecause = `status:${status.code}`;
      break;
    }
    if (status.data.shadow !== true) {
      // The one flag that keeps this traffic out of Voizo's reporting. Never dial without it.
      log.error({ campaign: status.data.campaignName }, "call.tick.abort — Voizo campaign is not shadow (is_test off)");
      summary.stoppedBecause = "not_shadow";
      break;
    }
    if (!status.data.ready) {
      summary.stoppedBecause =
        status.data.callWindowOpen === false ? "voizo_window_closed"
        : (status.data.remainingToday ?? 1) <= 0 ? "daily_cap_reached"
        : "voizo_busy";
      break;
    }

    const next = await claimNext(opts.campaignId, summary);
    if (!next) {
      summary.stoppedBecause = "no_due_leads";
      break;
    }

    const result = await dialOne(next, deadline, summary, status.data.campaignName ?? null);
    if (result !== "continue") {
      summary.stoppedBecause = result;
      break;
    }
  }

  log.info(summary, "call.tick.done");
  return summary;
}

// ── picking + claiming ──────────────────────────────────────────────────

interface Claimed {
  campaign: CampaignRow;
  member: MemberRow;
  lead: LeadRow;
  phone: string;
  /** The number is a test number typed in Call with AI (campaign_leads.call_phone), not the lead's own. */
  isTest: boolean;
}

async function claimNext(campaignId: string | undefined, summary: CallTickSummary): Promise<Claimed | null> {
  const db = getDb();
  let cq = db
    .from("call_campaigns")
    .select("id,name,timezone,country_code,call_days,call_start_hour,call_end_hour")
    .eq("channel", "call")
    .eq("status", "active");
  if (campaignId) cq = cq.eq("id", campaignId);
  const { data: camps } = await cq;
  const now = new Date();
  // Call with AI (Quick calls) any time; CRM campaigns keep their hours (lib/call-hours.ts callCampaignOpen).
  const open = ((camps ?? []) as CampaignRow[]).filter((c) => callCampaignOpen(c, now));
  if (open.length === 0) return null;
  const byId = new Map(open.map((c) => [c.id, c]));

  const nowIso = now.toISOString();
  const { data: rows } = await db
    .from("campaign_leads")
    .select("campaign_id,lead_id,call_attempts,leads(id,phone,country_code,lifecycle_stage,call_status,primary_offer,signal_type)")
    .in("campaign_id", [...byId.keys()])
    .in("status", ["pending", "called"])
    .lt("call_attempts", env.VOIZO_MAX_ATTEMPTS)
    .or(`next_call_at.is.null,next_call_at.lte.${nowIso}`)
    .order("added_at", { ascending: true })
    .limit(25);

  const members = (rows ?? []) as unknown as MemberRow[];
  const testPhones = await loadTestPhones(members);
  for (const member of members) {
    const lead = member.leads;
    const campaign = byId.get(member.campaign_id)!;
    if (!lead) continue;
    // A number typed in Call with AI (a test) is dialled instead of the lead's own (campaign_leads.call_phone).
    const testPhone = testPhones.get(`${member.campaign_id}:${member.lead_id}`) ?? null;

    const skip = await gateReason(lead, campaign, testPhone);
    if (skip) {
      summary.skipped += 1;
      await db
        .from("campaign_leads")
        .update({ status: "skipped", next_call_at: null })
        .eq("campaign_id", member.campaign_id)
        .eq("lead_id", member.lead_id);
      if (skip.callStatus) await db.from("leads").update({ call_status: skip.callStatus }).eq("id", lead.id);
      log.info({ lead_id: lead.id, reason: skip.reason }, "call.member.skipped");
      continue;
    }

    // Claim: push next_call_at out so a parallel tick can't pick the same member.
    const { data: claimed } = await db
      .from("campaign_leads")
      .update({ next_call_at: isoIn(CLAIM_MINUTES) })
      .eq("campaign_id", member.campaign_id)
      .eq("lead_id", member.lead_id)
      .or(`next_call_at.is.null,next_call_at.lte.${nowIso}`)
      .select("lead_id");
    if (!claimed?.length) continue;

    return { campaign, member, lead, phone: testPhone ?? toE164(lead.phone, lead.country_code ?? campaign.country_code)!, isTest: Boolean(testPhone) };
  }
  return null;
}

/** Test numbers on these queue entries, keyed "campaign:lead". Tolerates migration 060 not being applied. */
async function loadTestPhones(members: MemberRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!members.length) return out;
  const { data, error } = await getDb()
    .from("campaign_leads")
    .select("campaign_id,lead_id,call_phone")
    .in("lead_id", [...new Set(members.map((m) => m.lead_id))])
    .not("call_phone", "is", null);
  if (error) {
    if (!isMissingColumn(error, "call_phone")) log.warn({ err: error.message }, "call.test_phone_load_failed");
    return out;
  }
  for (const r of (data ?? []) as { campaign_id: string; lead_id: string; call_phone: string | null }[]) {
    const phone = r.call_phone ? toE164(r.call_phone) : null;
    if (phone) out.set(`${r.campaign_id}:${r.lead_id}`, phone);
  }
  return out;
}

async function gateReason(
  lead: LeadRow,
  campaign: CampaignRow,
  testPhone: string | null = null,
): Promise<{ reason: string; callStatus?: "dnc" } | null> {
  if (NO_CALL_LIFECYCLE.has(lead.lifecycle_stage ?? "")) return { reason: `lifecycle_${lead.lifecycle_stage}` };
  // No Voizo script pitches reputation management yet (review-site leads), so never dial them.
  if (noCallScript(lead)) return { reason: "no_call_script_for_offer" };
  if (NO_CALL_STATUS.has(lead.call_status ?? "")) return { reason: `call_status_${lead.call_status}` };
  const country = (lead.country_code ?? campaign.country_code ?? "").toLowerCase();
  if (isNoCallCountry(country)) return { reason: "gdpr_country" };
  if (!testPhone && !toE164(lead.phone, country)) return { reason: "phone_not_e164" };
  if (await isSuppressed(lead, "voice")) return { reason: "suppressed", callStatus: "dnc" };
  return null;
}

// ── dialling ────────────────────────────────────────────────────────────

async function dialOne(next: Claimed, deadline: number, summary: CallTickSummary, voizoScriptName: string | null): Promise<"continue" | string> {
  const db = getDb();
  const { campaign, member, lead, phone } = next;
  const memberKey = { campaign_id: campaign.id, lead_id: lead.id };
  const release = (minutes = 0) =>
    db.from("campaign_leads").update({ next_call_at: isoIn(minutes) }).match(memberKey);

  // The greeting the operator confirmed in the call preview (campaign_leads.call_name). Null = no name.
  const name = await memberCallName(memberKey);
  // The Voizo script picked in Call with AI (campaign_leads.voizo_campaign_id, 064); null = Voizo's default.
  const voizoCampaignId = await memberVoizoCampaign(memberKey);
  // Looked up before dialling: nothing may sit between Voizo's 202 and saving the call (it holds the only handle).
  const agentName = dialAgentName(voizoCampaignId, await agentNameFor(voizoCampaignId), voizoScriptName);
  const dial = await placeCall({ phone, name, clientRef: lead.id, campaignId: voizoCampaignId });

  if (!dial.ok) {
    const action = agentRefusal(classifyDialRefusal(dial.code, dial.status), dial.code, Boolean(voizoCampaignId));
    log.warn({ lead_id: lead.id, code: dial.code, action: action.kind }, "call.dial.refused");
    switch (action.kind) {
      case "skip_lead":
        if (action.suppress) {
          await addSuppression({ leadId: lead.id, phone, channel: "voice", reason: "voizo_suppressed" });
        }
        await db.from("campaign_leads").update({ status: "skipped", next_call_at: null }).match(memberKey);
        await db.from("leads").update({ call_status: action.callStatus }).eq("id", lead.id);
        await db.from("outreach_events").insert({
          lead_id: lead.id,
          kind: action.callStatus === "dnc" ? "call_dnc" : "call_bad_number",
          meta: { campaign_id: campaign.id, code: dial.code, phone },
        });
        summary.skipped += 1;
        return "continue";
      case "next_lead":
        await release(action.retryMinutes);
        return "continue";
      case "attempt_failed": {
        // Counts as an attempt (the carrier refused it, or it MAY have been placed).
        await db
          .from("campaign_leads")
          .update({ call_attempts: member.call_attempts + 1, last_call_at: new Date().toISOString() })
          .match(memberKey);
        const { data: row } = await db
          .from("call_attempts")
          .insert({
            lead_id: lead.id,
            campaign_id: campaign.id,
            provider: "voizo",
            status: action.attemptStatus,
            done: true,
            processed_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            offer_pitched: OFFERS.has(lead.primary_offer ?? "") ? lead.primary_offer : null,
            meta: { phone, code: dial.code, error: dial.error.slice(0, 300) },
          })
          .select("id")
          .single();
        await applyRoute(
          { leadId: lead.id, campaignId: campaign.id, attemptId: row?.id ?? null },
          routeCallResult({ status: action.attemptStatus }),
          { code: dial.code },
        );
        summary.finalized += 1;
        return "continue";
      }
      case "end_tick":
        await release(0);
        return `dial:${dial.code}`;
      case "abort":
        await release(0);
        log.error({ code: dial.code, error: dial.error }, "call.tick.abort (Voizo refused dial) — tell Chris");
        return `abort:${dial.code}`;
      case "agent_refused":
        // The picked voice agent's script was refused: set this call aside with a note, keep calling the others.
        await db.from("campaign_leads").update({ status: "skipped", next_call_at: null }).match(memberKey);
        await db.from("outreach_events").insert({
          lead_id: lead.id,
          kind: "call_agent_refused",
          meta: {
            voizo_campaign_id: voizoCampaignId,
            code: dial.code,
            note: "Voizo refused the chosen voice agent. Check its script id on the Voice agents page, then call again.",
          },
        });
        log.warn({ lead_id: lead.id, voizo_campaign_id: voizoCampaignId, code: dial.code }, "call.agent_refused");
        return "continue";
    }
  }

  // 202 — handed to the carrier. Store the callId first: it is the only handle.
  const nowIso = new Date().toISOString();
  const { data: attempt, error } = await db
    .from("call_attempts")
    .insert({
      lead_id: lead.id,
      campaign_id: campaign.id,
      provider: "voizo",
      provider_call_id: dial.data.callId,
      status: "dialing",
      started_at: nowIso,
      offer_pitched: OFFERS.has(lead.primary_offer ?? "") ? lead.primary_offer : null,
      // Call logs: which voice agent made the call (name snapshot) and whether it rang a test number.
      meta: {
        phone,
        remaining_today: dial.data.remainingToday ?? null,
        test_number: next.isTest,
        voizo_campaign_id: voizoCampaignId,
        agent_name: agentName,
      },
    })
    .select("id,lead_id,campaign_id,provider_call_id,created_at,meta")
    .single();
  if (error || !attempt) {
    // The call IS happening; without a row we'd lose its result. Stop loudly.
    log.error({ lead_id: lead.id, call_id: dial.data.callId, err: error?.message }, "call.attempt.insert_failed");
    return "attempt_insert_failed";
  }
  await db
    .from("campaign_leads")
    .update({ call_attempts: member.call_attempts + 1, last_call_at: nowIso, status: "called" })
    .match(memberKey);
  await db.from("leads").update({ call_status: "dialing" }).eq("id", lead.id);
  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "call_placed",
    meta: { call_id: dial.data.callId, campaign_id: campaign.id, phone },
  });
  summary.dialed += 1;

  const watched = await watch(attempt as AttemptRow, deadline);
  if (watched === "finalized") summary.finalized += 1;
  return watched === "finalized" ? "continue" : "call_still_live";
}

// ── polling + finalize ──────────────────────────────────────────────────

/** Poll one call until it's done (→ finalize), it's too old (→ unknown), or the tick ends. */
async function watch(attempt: AttemptRow, deadline: number): Promise<"finalized" | "pending"> {
  const db = getDb();
  for (;;) {
    const r = await getCall(attempt.provider_call_id);
    await db.from("call_attempts").update({ last_polled_at: new Date().toISOString() }).eq("id", attempt.id);

    if (r.ok && r.data.done) {
      const full = await getCall(attempt.provider_call_id, { transcript: true });
      const call = full.ok ? full.data : r.data;
      if (await finalize(attempt, call)) {
        // Try the recording now; usually not ready this fast, then the next tick's sweep picks it up.
        const meta = { ...(attempt.meta ?? {}), vapi_call_id: call.vapiCallId ?? null, recording_available: call.recordingAvailable ?? null };
        if (call.vapiCallId) await captureRecording({ id: attempt.id, meta, ended_at: call.endedAt ?? null, created_at: attempt.created_at });
      }
      return "finalized";
    }
    const age = Date.now() - new Date(attempt.created_at).getTime();
    if ((!r.ok && r.code === "not_found") || age >= GIVE_UP_MS) {
      await finalize(attempt, { status: "unknown" });
      return "finalized";
    }
    if (Date.now() + POLL_MS > deadline) return "pending";
    await sleep(POLL_MS);
  }
}

/** Write the result once. Returns false when another poller already finalized this call. */
async function finalize(attempt: AttemptRow, call: FinishedCall & Partial<VoizoCall>): Promise<boolean> {
  const db = getDb();
  const route = routeCallResult(call);
  const { data: claimed } = await db
    .from("call_attempts")
    .update({
      processed_at: new Date().toISOString(),
      done: true,
      status: route.attemptStatus,
      outcome: route.outcome,
      provider_status: call.status ?? null,
      provider_outcome: call.outcome ?? null,
      goal_reached: call.goalReached ?? null,
      voicemail: call.voicemail ?? null,
      ended_reason: call.endedReason ?? null,
      answered_at: call.answeredAt ?? null,
      ended_at: call.endedAt ?? null,
      duration_sec: call.durationSeconds ?? null,
      transcript: call.transcript || null,
      meta: {
        ...(attempt.meta ?? {}),
        vapi_call_id: call.vapiCallId ?? null,
        recording_available: call.recordingAvailable ?? null,
      },
    })
    .eq("id", attempt.id)
    .is("processed_at", null)
    .select("id");
  if (!claimed?.length) return false;

  await applyRoute({ leadId: attempt.lead_id, campaignId: attempt.campaign_id, attemptId: attempt.id }, route, {
    call_id: attempt.provider_call_id,
    status: call.status ?? null,
    outcome: call.outcome ?? null,
    goal_reached: call.goalReached ?? null,
    duration_seconds: call.durationSeconds ?? null,
    ended_at: call.endedAt ?? null,
  });
  log.info({ lead_id: attempt.lead_id, call_id: attempt.provider_call_id, event: route.event }, "call.finalized");
  return true;
}

/** Apply a routed result to the member, the lead and the activity log. */
async function applyRoute(
  ctx: { leadId: string; campaignId: string | null; attemptId: string | null },
  route: CallRoute,
  evidence: Record<string, unknown>,
): Promise<void> {
  const db = getDb();

  if (ctx.campaignId) {
    const key = { campaign_id: ctx.campaignId, lead_id: ctx.leadId };
    if (route.final) {
      await db.from("campaign_leads").update({ status: route.memberStatus, next_call_at: null }).match(key);
    } else {
      const { data: m } = await db.from("campaign_leads").select("call_attempts").match(key).maybeSingle();
      const exhausted = (m?.call_attempts ?? 0) >= env.VOIZO_MAX_ATTEMPTS;
      await db
        .from("campaign_leads")
        .update(
          exhausted
            ? { status: "done", next_call_at: null }
            : { status: "called", next_call_at: isoIn(env.VOIZO_RETRY_HOURS * 60) },
        )
        .match(key);
    }
  }

  // A call that reached someone moves the sales stage like an email does (Contacted / Replied on the CRM board).
  const { data: cur } = await db.from("leads").select("stage").eq("id", ctx.leadId).maybeSingle();
  const fromStage = (cur as { stage: string | null } | null)?.stage ?? null;
  const toStage = stageAfterCall(fromStage, route.event);
  await db
    .from("leads")
    .update({
      call_status: route.callStatus,
      ...(route.handoff ? { inbox_status: "needs_reply", inbox_read_at: null } : {}),
      ...(toStage ? { stage: toStage } : {}),
    })
    .eq("id", ctx.leadId);
  if (toStage) await recordStageEvent(ctx.leadId, toStage, fromStage);
  if (route.stopSequence) {
    await db
      .from("leads")
      .update({ seq_status: "stopped", seq_next_step_at: null })
      .eq("id", ctx.leadId)
      .in("seq_status", ["active", "paused"]);
  }
  await db.from("outreach_events").insert({
    lead_id: ctx.leadId,
    kind: route.event,
    meta: { ...evidence, campaign_id: ctx.campaignId, attempt_id: ctx.attemptId },
  });
}

/** The greeting name saved on this queue entry, or null. Tolerates migration 059 not being applied. */
async function memberVoizoCampaign(key: { campaign_id: string; lead_id: string }): Promise<string | null> {
  const { data, error } = await getDb().from("campaign_leads").select("voizo_campaign_id").match(key).maybeSingle();
  if (error) {
    if (!isMissingColumn(error, "voizo_campaign_id")) log.warn({ ...key, err: error.message }, "call.agent_load_failed");
    return null;
  }
  return (data as { voizo_campaign_id: string | null } | null)?.voizo_campaign_id ?? null;
}

async function memberCallName(key: { campaign_id: string; lead_id: string }): Promise<string | null> {
  const { data, error } = await getDb().from("campaign_leads").select("call_name").match(key).maybeSingle();
  if (error) {
    if (!isMissingColumn(error, "call_name")) log.warn({ ...key, err: error.message }, "call.name_load_failed");
    return null;
  }
  return (data as { call_name: string | null } | null)?.call_name ?? null;
}
