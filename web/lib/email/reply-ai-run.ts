/**
 * email/reply-ai-run.ts — AI reply handling: sort one human reply, write its draft answer, apply what the category
 * means to the lead (27 Nov 2026, workflow handle_replies_with_ai.md, migration 078).
 *
 * Inputs:  an inbound email_messages row (a human reply), its lead, our last email before it, the mailbox's
 *          from-name, the offer of our last email (outreach_events email_sent meta.email_used) or the lead's default
 *          offer; OPENAI_REPLY_MODEL through lib/services/openai-brain.ts brainJson
 * Outputs: draftMessage (one reply: email_messages ai_* columns + the lead's reply_category / inbox_status /
 *          follow-up; "stop" = the existing opt-out path) · draftPending (the inbox tick's pass over pending replies:
 *          capped, time-budgeted, 3 tries each) · redraftLatest (the Inbox's Redraft, 60 s apart)
 * Used by: lib/pipeline/inbox-sync.ts (Cloud Run MODE=inbox), app/api/leads/[id]/reply-draft/route.ts
 *
 * The AI never sends anything: a person sends the draft from the Inbox. Rules: lib/email/reply-ai.ts.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { brainJson, BrainError } from "@/lib/services/openai-brain";
import { resolveSegment, type SegmentLead } from "@/lib/segment";
import { defaultService, serviceEmail, SERVICES, type ServiceKey } from "@/lib/email/service-templates";
import { categoryEffects, parseReplyDraft, REPLY_SCHEMA, replyInput, replyInstructions, trimQuoted, type ReplyDraft } from "./reply-ai";

const log = getLogger("reply-ai");
const MAX_TRIES = 3;
const PASS_BUDGET_MS = 8 * 60_000;
const REDRAFT_WAIT_S = 60;
const MISSING_078 = "Run database update 078 (AI reply handling).";

export interface DraftContext {
  messageId: string;
  leadId: string;
  reply: string;
  attempts: number;
  lead: { business_name: string; category: string | null; city: string | null; next_follow_up_at: string | null; segmentLead: SegmentLead };
  ourLast: { subject: string; body: string } | null;
  sender: string;
  offerKey: ServiceKey;
  /** Is this the lead's latest reply? An older one finished late never overwrites the lead's label (an opt-out still counts). */
  isLatest: boolean;
}

/** What a draft does to the lead. inboxStatus null = leave the Inbox status alone (an older reply). */
export type LeadEffects = { leadPatch: Record<string, unknown>; unsubscribe: boolean; inboxStatus: "needs_reply" | "closed" | null };

/** A claim older than this is taken over (a run that died mid-draft). */
const CLAIM_STALE_MS = 15 * 60_000;

export interface DraftDeps {
  load(messageId: string): Promise<DraftContext | null>;
  /** Take the reply for this run (pending, or a stale claim); false = another run is drafting it: skip, pay nothing. */
  claim(messageId: string, now: Date): Promise<boolean>;
  ask: typeof brainJson;
  save(messageId: string, patch: Record<string, unknown>): Promise<void>;
  applyLead(leadId: string, effects: LeadEffects, draft: ReplyDraft): Promise<void>;
  now(): Date;
}

const isServiceKey = (k: string): k is ServiceKey => SERVICES.some((s) => s.key === k);

const realDeps: DraftDeps = {
  load: async (messageId) => {
    const db = getDb();
    const { data: m } = await db.from("email_messages").select("id,lead_id,body_text,created_at,ai_attempts").eq("id", messageId).maybeSingle();
    const msg = m as { id: string; lead_id: string | null; body_text: string | null; created_at: string; ai_attempts: number | null } | null;
    if (!msg?.lead_id) return null;
    const [{ data: l }, { data: last }, { data: sent }, { data: newest }] = await Promise.all([
      db.from("leads").select("id,business_name,category,address,next_follow_up_at,call_segment,website_kind,has_website,needs_improvement,signal_type").eq("id", msg.lead_id).maybeSingle(),
      db
        .from("email_messages")
        .select("subject,body_text,from_addr")
        .eq("lead_id", msg.lead_id)
        .eq("direction", "outbound")
        .lt("created_at", msg.created_at)
        .order("created_at", { ascending: false })
        .limit(1),
      db.from("outreach_events").select("key:meta->email_used->>key").eq("lead_id", msg.lead_id).eq("kind", "email_sent").order("created_at", { ascending: false }).limit(1),
      db.from("email_messages").select("id").eq("lead_id", msg.lead_id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1),
    ]);
    const lead = l as (SegmentLead & { business_name: string; category: string | null; address: string | null; next_follow_up_at: string | null }) | null;
    if (!lead) return null;
    const ours = ((last ?? []) as { subject: string | null; body_text: string | null; from_addr: string | null }[])[0] ?? null;
    let sender = "";
    if (ours?.from_addr) {
      const { data: acc } = await db.from("email_accounts").select("from_name").eq("email", ours.from_addr).maybeSingle();
      sender = (acc as { from_name: string | null } | null)?.from_name?.trim() || "";
    }
    const usedKey = ((sent ?? []) as { key: string | null }[])[0]?.key ?? "";
    const fromUsed = usedKey.startsWith("service:") ? usedKey.slice("service:".length) : "";
    const offerKey: ServiceKey = isServiceKey(fromUsed) ? fromUsed : defaultService(resolveSegment(lead));
    const parts = (lead.address ?? "").split(",").map((s) => s.trim());
    return {
      messageId: msg.id,
      leadId: msg.lead_id,
      reply: msg.body_text ?? "",
      attempts: msg.ai_attempts ?? 0,
      lead: { business_name: lead.business_name, category: lead.category, city: parts.length >= 2 ? parts[parts.length - 2] : null, next_follow_up_at: lead.next_follow_up_at, segmentLead: lead },
      ourLast: ours ? { subject: ours.subject ?? "", body: ours.body_text ?? "" } : null,
      sender: sender || "The team",
      offerKey,
      isLatest: ((newest ?? []) as { id: string }[])[0]?.id === msg.id,
    };
  },
  claim: async (messageId, now) => {
    const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
    const { data, error } = await getDb()
      .from("email_messages")
      .update({ ai_state: "drafting", ai_claimed_at: now.toISOString() })
      .eq("id", messageId)
      .or(`ai_state.eq.pending,and(ai_state.eq.drafting,ai_claimed_at.lt.${stale})`)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },
  ask: brainJson,
  save: async (messageId, patch) => {
    const { error } = await getDb().from("email_messages").update(patch).eq("id", messageId);
    if (error) throw new Error(error.message);
  },
  applyLead: async (leadId, effects, draft) => {
    // Every write must succeed (it throws otherwise): the reply is then tried again, so an opt-out is never lost.
    const db = getDb();
    const must = (r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(r.error.message);
    };
    const patch = { ...effects.leadPatch, ...(effects.inboxStatus ? { inbox_status: effects.inboxStatus } : {}) };
    if (Object.keys(patch).length) must(await db.from("leads").update(patch).eq("id", leadId));
    if (effects.unsubscribe) {
      // The existing opt-out path: an unsubscribe event and the sequence stops (like a "remove me" the reader detects).
      must(await db.from("outreach_events").insert({ lead_id: leadId, kind: "email_unsubscribe", meta: { source: "ai_reply", summary: draft.summary } }));
      must(await db.from("leads").update({ seq_status: "stopped", seq_next_step_at: null }).eq("id", leadId).eq("seq_status", "active"));
    }
    if (draft.referral) {
      const who = [draft.referral.name, draft.referral.email ? `<${draft.referral.email}>` : null].filter(Boolean).join(" ");
      must(await db.from("lead_notes").insert({ lead_id: leadId, body: `Their reply points to someone else: ${who}`, author: "AI reply" }));
    }
  },
  now: () => new Date(),
};

/** Sort and draft one reply. Never sends anything. */
export async function draftMessage(messageId: string, deps: DraftDeps = realDeps): Promise<{ ok: true; draft: ReplyDraft } | { ok: false; error: string }> {
  const ctx = await deps.load(messageId);
  if (!ctx) return { ok: false, error: "not found" };
  // One run per reply: a reply another run is drafting is skipped (never paid twice).
  if (!(await deps.claim(messageId, deps.now()))) return { ok: false, error: "busy" };
  const svc = SERVICES.find((s) => s.key === ctx.offerKey);
  const input = replyInput({
    reply: trimQuoted(ctx.reply),
    ourLast: ctx.ourLast,
    business: ctx.lead.business_name,
    category: ctx.lead.category,
    city: ctx.lead.city,
    offerLabel: svc?.label ?? ctx.offerKey,
    offerFacts: serviceEmail(ctx.offerKey, { businessName: ctx.lead.business_name, city: ctx.lead.city, category: ctx.lead.category }).body,
    sender: ctx.sender,
  });
  const at = deps.now().toISOString();
  let draft: ReplyDraft | null = null;
  let error = "The AI's answer couldn't be used";
  try {
    const { data, usd } = await deps.ask<unknown>({ name: "reply_draft", model: env.OPENAI_REPLY_MODEL, instructions: replyInstructions(), input, schema: REPLY_SCHEMA, maxOutputTokens: 900 });
    draft = parseReplyDraft(data, { model: env.OPENAI_REPLY_MODEL, usd, at });
  } catch (err) {
    if (err instanceof BrainError && (err.code === "key_invalid" || err.code === "no_credit" || err.code === "not_configured")) throw err;
    error = String(err instanceof Error ? err.message : err).slice(0, 300);
  }
  const failTry = async (why: string) => {
    const attempts = ctx.attempts + 1;
    await deps.save(messageId, { ai_attempts: attempts, ai_error: why, ai_state: attempts >= MAX_TRIES ? "failed" : "pending" });
    log.warn({ message_id: messageId, attempts, error: why }, "reply_ai.draft_failed");
    return { ok: false as const, error: why };
  };
  if (!draft) return failTry(error);
  // The lead first (label, opt-out, follow-up), THEN the reply is marked done: a failed write is a try, never a lost
  // opt-out. An older reply finished late doesn't touch the lead's label or Inbox status; an opt-out still counts.
  const full = categoryEffects(draft.category, { next_follow_up_at: ctx.lead.next_follow_up_at }, deps.now());
  const effects: LeadEffects = ctx.isLatest
    ? full
    : { leadPatch: full.unsubscribe ? { lifecycle_stage: "unsubscribed" } : {}, unsubscribe: full.unsubscribe, inboxStatus: null };
  try {
    await deps.applyLead(ctx.leadId, effects, draft);
  } catch (err) {
    return failTry(`Couldn't update the lead: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
  await deps.save(messageId, {
    ai_state: "done",
    ai_category: draft.category,
    ai_summary: draft.summary,
    ai_draft_body: draft.body,
    ai_referral: draft.referral,
    ai_at: draft.at,
    ai_usd: draft.usd,
    ai_error: null,
    ai_attempts: ctx.attempts + 1,
  });
  log.info({ message_id: messageId, lead_id: ctx.leadId, category: draft.category, usd: draft.usd }, "reply_ai.drafted");
  return { ok: true, draft };
}

type PassDeps = {
  listPending(cap: number): Promise<string[]>;
  draftOne(messageId: string): Promise<{ ok: true; draft: ReplyDraft } | { ok: false; error: string }>;
};

const realPass: PassDeps = {
  listPending: async (cap) => {
    const { data, error } = await getDb()
      .from("email_messages")
      .select("id")
      .eq("direction", "inbound")
      .or(`ai_state.eq.pending,and(ai_state.eq.drafting,ai_claimed_at.lt.${new Date(Date.now() - CLAIM_STALE_MS).toISOString()})`)
      .order("created_at", { ascending: true })
      .limit(cap);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  },
  draftOne: (id) => draftMessage(id),
};

/** The inbox tick's pass: draft the pending human replies, oldest first, capped and time-budgeted. */
export async function draftPending(
  o: { budgetMs?: number; cap?: number } = {},
  deps: PassDeps = realPass,
): Promise<{ drafted: number; failed: number; usd: number } | { skipped: string }> {
  let ids: string[];
  try {
    ids = await deps.listPending(o.cap ?? env.REPLY_AI_MAX_PER_RUN);
  } catch (err) {
    if (/ai_state/.test(String(err))) return { skipped: MISSING_078 };
    throw err;
  }
  const until = Date.now() + (o.budgetMs ?? PASS_BUDGET_MS);
  const out = { drafted: 0, failed: 0, usd: 0 };
  for (const id of ids) {
    if (Date.now() >= until) break;
    try {
      const r = await deps.draftOne(id);
      if (r.ok) {
        out.drafted++;
        out.usd = Math.round((out.usd + (r.draft.usd ?? 0)) * 1e6) / 1e6;
      } else out.failed++;
    } catch (err) {
      out.failed++;
      log.warn({ message_id: id, err: String(err).slice(0, 200) }, "reply_ai.pass_stopped");
      if (err instanceof BrainError) break; // dead key / no credit: the next run tries again
    }
  }
  return out;
}

export class RedraftTooSoonError extends Error {
  constructor(readonly waitSeconds: number) {
    super(`This reply was just drafted. Try again in ${waitSeconds} seconds.`);
    this.name = "RedraftTooSoonError";
  }
}

type RedraftDeps = {
  latest(leadId: string): Promise<{ id: string; ai_at: string | null } | null>;
  reset(messageId: string): Promise<void>;
  draftOne(messageId: string): Promise<{ ok: true; draft: ReplyDraft } | { ok: false; error: string }>;
};

const realRedraft: RedraftDeps = {
  latest: async (leadId) => {
    const { data, error } = await getDb()
      .from("email_messages")
      .select("id,ai_at")
      .eq("lead_id", leadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; ai_at: string | null }[])[0] ?? null;
  },
  reset: async (messageId) => {
    const { error } = await getDb().from("email_messages").update({ ai_attempts: 0, ai_state: "pending", ai_claimed_at: null }).eq("id", messageId);
    if (error) throw new Error(error.message);
  },
  draftOne: (id) => draftMessage(id),
};

/** The Inbox's "Draft with AI" / "Redraft": the lead's latest reply, at most once a minute. */
export async function redraftLatest(leadId: string, now: Date = new Date(), deps: RedraftDeps = realRedraft): Promise<ReplyDraft> {
  const m = await deps.latest(leadId);
  if (!m) throw new Error("No reply to draft yet.");
  if (m.ai_at) {
    const wait = Math.ceil(REDRAFT_WAIT_S - (now.getTime() - Date.parse(m.ai_at)) / 1000);
    if (wait > 0) throw new RedraftTooSoonError(wait);
  }
  await deps.reset(m.id);
  const r = await deps.draftOne(m.id);
  if (!r.ok) throw new Error(`The AI couldn't draft this one: ${r.error}`);
  return r.draft;
}
