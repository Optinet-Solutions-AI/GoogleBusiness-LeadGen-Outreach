/**
 * campaigns/batch-email-plan.ts — "Email this batch" (24 Nov 2026): the preview (who gets an email, who is skipped
 * and why, the email per offer with a sample) and the start (a campaign + each lead's written plan).
 *
 * Inputs:  a batch id; { includeEu, choices: offer → "auto" | "saved:<id>" } to preview; plus { dailyLimit,
 *          followUps } to start
 * Outputs: loadBatchEmailPlan(...) → BatchEmailPlan · startBatchEmail(...) → { campaignId, enrolled, failed, days }
 *          (the campaign is "building" while leads are set up, then "active"; members = only the leads set up)
 *          (a call_campaigns row, channel email, email_mode 'offers'; campaign_leads; each lead's seq_* plan)
 * Used by: app/api/batches/[id]/email/route.ts
 *
 * Rules live in lib/campaigns/batch-email.ts (pure). Nothing is sent here: the email scheduler (Cloud Scheduler
 * email-sequence-tick, every 3 minutes) sends each first email at its slot, Mon–Fri 9:00–17:00 in the batch's
 * country time, at most `dailyLimit` a day, and stops on a reply / bounce / unsubscribe. Pause / stop it from the
 * Campaigns page. Needs migration 067 to start (the settings columns).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { campaignTimezone } from "@/lib/call-hours";
import { staggerSends, type SendWindow } from "@/lib/campaigns/send-window";
import { SERVICES, type ServiceKey } from "@/lib/email/service-templates";
import { listTemplates } from "@/lib/email/template-library";
import { listTests, runningWithCounts, winnersByOffer } from "@/lib/email/email-tests";
import { formLeadOk } from "@/lib/automation/rules";
import { buildLeadPlan, emailFor, makeEmailPicker, offerFor, poolFor, sendingDays, skipReason, SKIP_TEXT, type BatchLead, type BatchSkip, type SavedTpl } from "./batch-email";

const log = getLogger("batch-email");

export const MISSING_067 = "Batch emails need database update 067 (run db/migrations/067_batch_email.sql in Supabase).";
export const MISSING_072 = "3 follow-ups need database update 072 (run db/migrations/072_batch_follow_ups.sql in Supabase). Pick 2 or fewer until then.";
export const MISSING_068 = "This needs database update 068 (run db/migrations/068_automation.sql in Supabase).";
export const DEFAULT_DAILY_LIMIT = 10;
/** Mon–Fri, 9:00–17:00 in the batch's country time. */
const WINDOW_DAYS = [1, 2, 3, 4, 5];
const START_HOUR = 9;
const END_HOUR = 17;

export class BatchEmailError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "BatchEmailError";
  }
}

export interface OfferGroup {
  offer: ServiceKey;
  label: string;
  count: number;
  /** "auto" + the saved templates for this offer (or for any offer). */
  choices: { key: string; label: string }[];
  /** What "auto" means for this offer right now (a wording test, the last winner, or the ready-made email). */
  autoLabel: string;
  sample: { to: string; from: string; subject: string; body: string; emailLabel: string } | null;
}

export interface BatchEmailPlan {
  batchName: string;
  total: number;
  eligible: number;
  /** Eligible but never checked: checked right before the first email (bad ones are skipped then). */
  toCheck: number;
  skipped: { reason: BatchSkip; text: string; count: number }[];
  /** Leads left out only because they're in the EU / UK (shown so the switch is meaningful). */
  euCount: number;
  groups: OfferGroup[];
  senders: string[];
  timezone: string;
  /** An active batch email already running for this batch (its name), or null. */
  running: string | null;
  /** Leads with no email that would get the offer through their own-site contact form (when switched on). */
  formLeads: number;
}

const LEAD_COLS =
  "id,business_name,email,verification_status,qualified,lifecycle_stage,stage,seq_status,country_code,call_segment," +
  "website_kind,has_website,needs_improvement,signal_type,signal_meta,contact_owner_name,category,demo_url,ai_profile," +
  "website_url,contact_page_url";

type Mailbox = { email: string; from_name: string | null };

async function loadBatchLeads(batchId: string): Promise<BatchLead[]> {
  const out: BatchLead[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await getDb().from("leads").select(LEAD_COLS).eq("batch_id", batchId).order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as BatchLead[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function emailedLeadIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await getDb().from("outreach_events").select("lead_id").eq("kind", "email_sent").in("lead_id", ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { lead_id: string }[]) out.add(r.lead_id);
  }
  return out;
}

async function context(batchId: string) {
  const db = getDb();
  const { data: batch } = await db.from("batches").select("id,niche,city").eq("id", batchId).maybeSingle();
  if (!batch) throw new BatchEmailError("Batch not found", 404);
  const b = batch as { id: string; niche: string | null; city: string | null };
  const [leads, { templates }, tests, finished, boxes, running] = await Promise.all([
    loadBatchLeads(batchId),
    listTemplates(),
    runningWithCounts().catch(() => []),
    listTests().then((r) => r.tests).catch(() => []),
    db.from("email_accounts").select("email,from_name").eq("status", "active").then((r) => ((r.data ?? []) as Mailbox[])),
    // Active, paused or still being set up all count: one batch email per batch.
    db.from("call_campaigns").select("name").eq("batch_id", batchId).eq("channel", "email").in("status", ["active", "paused", "building"]).limit(1).then((r) => ((r.data ?? []) as { name: string }[])[0]?.name ?? null),
  ]);
  const emailed = await emailedLeadIds(leads.map((l) => l.id));
  const triedForm = await formTriedIds(leads.map((l) => l.id));
  const saved: SavedTpl[] = templates.map((t) => ({ ...t, version: (t as { version?: number }).version ?? 1 }));
  return {
    batch: b,
    leads,
    emailed,
    saved,
    tests: tests.map((t) => ({ id: t.id, serviceKey: t.service_key, aKey: t.a_key, bKey: t.b_key, sentA: t.sentA, sentB: t.sentB })),
    winners: winnersByOffer(finished),
    mailboxes: boxes,
    running,
    triedForm,
  };
}

/** Leads that already had a contact-form attempt (each lead gets an automatic form once). Table missing = none. */
async function formTriedIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await getDb().from("contact_form_runs").select("lead_id").in("lead_id", ids.slice(i, i + 150));
    if (error) return out;
    for (const r of (data ?? []) as { lead_id: string }[]) out.add(r.lead_id);
  }
  return out;
}

/** How many leads of the batch would get the offer through their contact form (no email, own-site form). */
function formLeadCount(ctx: Awaited<ReturnType<typeof context>>, includeEu: boolean): number {
  return ctx.leads.filter((l) => {
    const f = l as BatchLead & { website_url?: string | null; contact_page_url?: string | null };
    return formLeadOk(
      { ...f, website_url: f.website_url ?? null, contact_page_url: f.contact_page_url ?? null },
      { emailed: ctx.emailed.has(l.id), triedForm: ctx.triedForm.has(l.id), includeEu },
    );
  }).length;
}

function mainTimezone(leads: BatchLead[]): string {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const cc = (l.country_code ?? "").toLowerCase();
    if (cc) counts.set(cc, (counts.get(cc) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "us";
  return campaignTimezone(top);
}

function select(ctx: Awaited<ReturnType<typeof context>>, includeEu: boolean) {
  const eligible: BatchLead[] = [];
  const skipped = new Map<BatchSkip, number>();
  for (const l of ctx.leads) {
    const r = skipReason(l, { emailed: ctx.emailed, includeEu });
    if (r) skipped.set(r, (skipped.get(r) ?? 0) + 1);
    else eligible.push(l);
  }
  return { eligible, skipped };
}

export async function loadBatchEmailPlan(batchId: string, o: { includeEu: boolean; choices: Record<string, string> }): Promise<BatchEmailPlan> {
  const ctx = await context(batchId);
  const { eligible, skipped } = select(ctx, o.includeEu);
  const euCount = o.includeEu ? 0 : (skipped.get("eu") ?? 0);
  const byOffer = new Map<ServiceKey, BatchLead[]>();
  for (const l of eligible) {
    const offer = offerFor(l);
    byOffer.set(offer, [...(byOffer.get(offer) ?? []), l]);
  }
  const label = (k: string) => SERVICES.find((s) => s.key === k)?.label ?? k;
  const groups: OfferGroup[] = [...byOffer.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([offer, leads]) => {
      const test = ctx.tests.find((t) => t.serviceKey === offer);
      const winner = ctx.winners[offer];
      const winnerTpl = winner?.startsWith("saved:") ? ctx.saved.find((t) => `saved:${t.id}` === winner) : undefined;
      const autoLabel = test ? "Wording test (takes turns between A and B)" : winnerTpl ? `Winner of the last test: ${winnerTpl.name}` : `Ready-made: ${label(offer)}`;
      const choice = o.choices[offer] ?? "auto";
      // The sample uses a fresh picker so showing it never moves a wording test's turn.
      const picked = makeEmailPicker({ tests: ctx.tests, winners: ctx.winners }).pick(offer, choice);
      const box = poolFor(offer, ctx.mailboxes)[0];
      const first = leads[0];
      const email = first ? emailFor(picked.key, offer, first, { city: ctx.batch.city, senderName: box?.from_name ?? null }, ctx.saved) : null;
      return {
        offer,
        label: label(offer),
        count: leads.length,
        autoLabel,
        choices: [
          { key: "auto", label: autoLabel },
          ...ctx.saved.filter((t) => !t.service_key || t.service_key === offer).map((t) => ({ key: `saved:${t.id}`, label: `Saved: ${t.name}` })),
        ],
        sample: email && first?.email ? { to: first.email, from: box?.email ?? "", subject: email.subject, body: email.body, emailLabel: email.label } : null,
      };
    });
  return {
    batchName: [ctx.batch.niche, ctx.batch.city].filter(Boolean).join(" · ") || "Batch",
    total: ctx.leads.length,
    eligible: eligible.length,
    toCheck: eligible.filter((l) => !l.verification_status || l.verification_status === "unknown").length,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, text: SKIP_TEXT[reason], count })).sort((a, b) => b.count - a.count),
    euCount,
    groups,
    senders: ctx.mailboxes.map((m) => m.email),
    timezone: mainTimezone(eligible.length ? eligible : ctx.leads),
    running: ctx.running,
    formLeads: formLeadCount(ctx, o.includeEu),
  };
}

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

export async function startBatchEmail(
  batchId: string,
  o: { includeEu: boolean; choices: Record<string, string>; dailyLimit: number; followUps: 0 | 1 | 2 | 3; contactForms?: boolean },
): Promise<{ campaignId: string; enrolled: number; failed: number; days: number; firstAt: string | null }> {
  const ctx = await context(batchId);
  if (ctx.running) throw new BatchEmailError(`This batch is already being emailed ("${ctx.running}"). Pause or finish it on the Campaigns page first.`);
  if (!ctx.mailboxes.length) throw new BatchEmailError("No sending mailbox is connected. Connect one on the Email page first.");
  const { eligible } = select(ctx, o.includeEu);
  // A batch with no emailable lead still runs when its contact forms have someone to reach (review fix, 24 Nov 2026).
  const formsOnly = !!o.contactForms && formLeadCount(ctx, o.includeEu) > 0;
  if (!eligible.length && !formsOnly) throw new BatchEmailError("No lead in this batch can be emailed (see the reasons in the preview).");

  const db = getDb();
  const timezone = mainTimezone(eligible);
  const name = `Batch email · ${[ctx.batch.niche, ctx.batch.city].filter(Boolean).join(" · ") || "batch"} · ${new Date().toISOString().slice(0, 10)}`;
  const { data: camp, error } = await db
    .from("call_campaigns")
    .insert({
      name,
      source: "app",
      channel: "email",
      batch_id: batchId,
      target_count: eligible.length,
      call_days: WINDOW_DAYS,
      call_start_hour: START_HOUR,
      call_end_hour: END_HOUR,
      timezone,
      sender_emails: ctx.mailboxes.map((m) => m.email),
      // "building" until every lead is set up; then "active" (a start that dies part-way can be retried).
      status: "building",
      email_mode: "offers",
      daily_limit: o.dailyLimit,
      follow_ups: o.followUps,
      include_eu: o.includeEu,
      email_choice: o.choices,
      // Leads with no email get the offer through their contact form (lib/automation/auto-contact-forms.ts, 068).
      ...(o.contactForms ? { contact_forms: true } : {}),
    })
    .select("id")
    .single();
  if (error) {
    if (/contact_forms/.test(error.message)) throw new BatchEmailError(MISSING_068, 503);
    // A missing column means 067 isn't applied; a check-constraint error on follow_ups means 072 isn't (3 follow-ups).
    if (/check constraint/i.test(error.message) && /follow_ups/.test(error.message)) throw new BatchEmailError(MISSING_072, 503);
    if (/email_mode|daily_limit|follow_ups|include_eu|email_choice/.test(error.message)) throw new BatchEmailError(MISSING_067, 503);
    throw new Error(error.message);
  }
  const campaignId = (camp as { id: string }).id;

  // First emails spread over the window: one every (window minutes / daily limit), so each day takes about the
  // daily limit; overflow rolls to the next weekday. The scheduler holds anything beyond the limit as a backstop.
  const window: SendWindow = { tz: timezone, days: WINDOW_DAYS, startHour: START_HOUR, endHour: END_HOUR };
  // nextSlot adds 4–20 minutes of jitter to each slot (about 12 on average): take it off the gap.
  const gapMinutes = Math.max(3, Math.round(((END_HOUR - START_HOUR) * 60) / o.dailyLimit) - 12);
  const schedule = staggerSends({ ids: eligible.map((l) => l.id), window, after: new Date(), gapMinutes });

  const picker = makeEmailPicker({ tests: ctx.tests, winners: ctx.winners });
  const turn = new Map<ServiceKey, number>();
  const enrolledIds: string[] = [];
  let failed = 0;
  await inPool(eligible, 8, async (l) => {
    try {
      const offer = offerFor(l);
      const pool = poolFor(offer, ctx.mailboxes);
      const n = turn.get(offer) ?? 0;
      turn.set(offer, n + 1);
      const box = pool[n % pool.length];
      const picked = picker.pick(offer, o.choices[offer] ?? "auto");
      const email = emailFor(picked.key, offer, l, { city: ctx.batch.city, senderName: box.from_name }, ctx.saved);
      const plan = buildLeadPlan({
        email,
        // A test version that fell back to the ready-made email isn't that version any more.
        test: email.key === picked.key ? picked.test : null,
        followUps: o.followUps,
        campaignId,
        dailyLimit: o.dailyLimit,
        sender: box.email,
        sendAt: schedule[l.id],
      });
      // Never overwrite a lead that started another sequence since the preview.
      const { data, error: uErr } = await db.from("leads").update(plan).eq("id", l.id).or("seq_status.is.null,seq_status.in.(none,stopped,completed)").select("id");
      if (uErr) throw new Error(uErr.message);
      if (data?.length) enrolledIds.push(l.id);
      else failed++;
    } catch (err) {
      failed++;
      log.warn({ lead_id: l.id, err: String(err) }, "batch_email.enroll_failed");
    }
  });
  const enrolled = enrolledIds.length;
  if (!enrolled && !formsOnly) {
    await db.from("call_campaigns").delete().eq("id", campaignId);
    throw new BatchEmailError("No lead could be set up (they may have started other emails since the preview). Nothing will be sent.");
  }
  // Members = only the leads that really got a plan: pausing / deleting this campaign then touches only them.
  for (let i = 0; i < enrolledIds.length; i += 200) {
    const { error: mErr } = await db.from("campaign_leads").insert(enrolledIds.slice(i, i + 200).map((id) => ({ campaign_id: campaignId, lead_id: id, status: "pending" })));
    if (mErr) throw new Error(mErr.message);
  }
  await db.from("call_campaigns").update({ target_count: enrolled, status: "active" }).eq("id", campaignId);
  const times = enrolledIds.map((id) => schedule[id]).filter(Boolean).sort();
  if (!enrolled) log.info({ batch_id: batchId, campaign_id: campaignId }, "batch_email.contact_forms_only");
  log.info({ batch_id: batchId, campaign_id: campaignId, enrolled, failed, daily_limit: o.dailyLimit, follow_ups: o.followUps }, "batch_email.started");
  return { campaignId, enrolled, failed, days: sendingDays(times, timezone), firstAt: times[0] ?? null };
}
