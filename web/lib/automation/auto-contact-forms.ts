/**
 * automation/auto-contact-forms.ts — send a batch email's offer through the contact form of leads with no email
 * (24 Nov 2026): at most 10 a day in all, 2 per run, Mon–Fri 9–17 in the batch's time, each lead tried once.
 *
 * Inputs:  running batch emails with contact forms on (call_campaigns contact_forms, migration 068), their batch's
 *          leads, earlier contact-form attempts and emails, the active mailboxes, saved templates
 * Outputs: contact_form_runs (source 'auto') through the normal look → send steps (lib/contact-form/runs.ts): their
 *          screenshots, events (contact_form_sent / _blocked / _failed) and stage "outreached" on a sent form
 * Used by: lib/automation/tick.ts (Cloud Run MODE=automation: it has the browser the form steps need)
 *
 * The message is the batch email's own email for the lead's offer (Send email's ready-made email, or the saved template
 * chosen for that offer), signed by the mailbox it comes from. A protected form (CAPTCHA) or no form = that lead is
 * left for a person (the attempt shows in its Contact page window). The kill switch stops it too.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isWithinWindow, type SendWindow } from "@/lib/campaigns/send-window";
import { emailFor, makeEmailPicker, offerFor, poolFor, type BatchLead, type SavedTpl } from "@/lib/campaigns/batch-email";
import { listTemplates } from "@/lib/email/template-library";
import { listTests, winnersByOffer } from "@/lib/email/email-tests";
import { latestRun, runLookStep, runSendStep, startLook, startSend } from "@/lib/contact-form/runs";
import { formLeadOk, formsRoom, FORMS_PER_DAY, FORMS_PER_TICK } from "./rules";

const log = getLogger("auto-contact-forms");

type Campaign = {
  id: string;
  batch_id: string | null;
  timezone: string | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  include_eu: boolean | null;
  email_choice: Record<string, string> | null;
};
type FormBatchLead = BatchLead & { website_url: string | null; contact_page_url: string | null };

const LEAD_COLS =
  "id,business_name,email,verification_status,qualified,lifecycle_stage,stage,seq_status,country_code,call_segment," +
  "website_kind,has_website,needs_improvement,signal_type,signal_meta,contact_owner_name,category,demo_url,website_url,contact_page_url";

async function idsWith(table: "contact_form_runs" | "outreach_events", ids: string[], kind?: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    let q = getDb().from(table).select("lead_id").in("lead_id", ids.slice(i, i + 150));
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    // A failed read must never look like "never tried": stop this run instead.
    if (error) throw new Error(`can't read ${table}: ${error.message}`);
    for (const r of (data ?? []) as { lead_id: string }[]) out.add(r.lead_id);
  }
  return out;
}

export async function runAutoContactForms(now: number = Date.now()): Promise<{ sent: number; looked: number; note?: string }> {
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > now) return { sent: 0, looked: 0, note: "kill switch on" };
  const db = getDb();

  const countToday = async (): Promise<number | null> => {
    const { count, error: countErr } = await db
      .from("contact_form_runs")
      .select("id", { count: "exact", head: true })
      .eq("source", "auto")
      .not("message", "is", null)
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    return countErr ? null : (count ?? 0);
  };
  const count = await countToday();
  if (count === null) return { sent: 0, looked: 0, note: "can't count today's forms (migration 068 applied?)" };
  let room = formsRoom(count);
  if (room <= 0) return { sent: 0, looked: 0, note: "today's 10 are done" };

  const { data: camps, error } = await db
    .from("call_campaigns")
    .select("id,batch_id,timezone,call_days,call_start_hour,call_end_hour,include_eu,email_choice")
    .eq("channel", "email")
    .eq("email_mode", "offers")
    .eq("status", "active")
    .eq("contact_forms", true);
  if (error) return { sent: 0, looked: 0, note: `can't read campaigns: ${error.message}` };

  const [{ templates }, finished, { data: boxData }] = await Promise.all([
    listTemplates(),
    listTests().then((r) => r.tests).catch(() => []),
    db.from("email_accounts").select("email,from_name").eq("status", "active"),
  ]);
  const boxes = (boxData ?? []) as { email: string; from_name: string | null }[];
  if (!boxes.length) return { sent: 0, looked: 0, note: "no mailbox connected" };
  const saved: SavedTpl[] = templates.map((t) => ({ ...t, version: (t as { version?: number }).version ?? 1 }));
  const picker = makeEmailPicker({ tests: [], winners: winnersByOffer(finished) });

  let sent = 0;
  let looked = 0;
  let turn = 0;
  for (const c of (camps ?? []) as Campaign[]) {
    if (room <= 0 || looked >= FORMS_PER_TICK * 2) break;
    if (!c.batch_id) continue;
    const window: SendWindow = { tz: c.timezone ?? "America/New_York", days: c.call_days ?? [1, 2, 3, 4, 5], startHour: c.call_start_hour ?? 9, endHour: c.call_end_hour ?? 17 };
    if (!isWithinWindow(new Date(now), window)) continue;

    const [{ data: batch }, { data: leadData }] = await Promise.all([
      db.from("batches").select("city").eq("id", c.batch_id).maybeSingle(),
      db.from("leads").select(LEAD_COLS).eq("batch_id", c.batch_id).is("email", null).limit(500),
    ]);
    const leads = (leadData ?? []) as unknown as FormBatchLead[];
    if (!leads.length) continue;
    const ids = leads.map((l) => l.id);
    const [tried, emailed] = await Promise.all([idsWith("contact_form_runs", ids), idsWith("outreach_events", ids, "email_sent")]);
    const queue = leads.filter((l) => formLeadOk(l, { emailed: emailed.has(l.id), triedForm: tried.has(l.id), includeEu: !!c.include_eu }));

    for (const lead of queue) {
      if (room <= 0 || looked >= FORMS_PER_TICK * 2) break;
      // Marked automatic when created (counted in the 10 a day whatever happens next).
      const start = await startLook(lead.id, { force: true, source: "auto" });
      // Refused (e.g. on the suppression list): no attempt was made, so it doesn't use up this run's looks.
      if (!start.ok) continue;
      looked++;
      await runLookStep(start.run.id);
      const run = await latestRun(lead.id);
      if (!run || run === "no_table" || run.id !== start.run.id || run.status !== "ready") {
        log.info({ lead_id: lead.id, status: run && run !== "no_table" ? run.status : null }, "auto_form.no_send");
        continue;
      }
      const offer = offerFor(lead);
      const pool = poolFor(offer, boxes);
      const box = pool[turn++ % pool.length];
      const picked = picker.pick(offer, c.email_choice?.[offer] ?? "auto");
      const email = emailFor(picked.key, offer, lead, { city: (batch as { city: string | null } | null)?.city ?? null, senderName: box.from_name }, saved);
      // Re-check right before the paid send: still within today's 10 (another run may have sent), still inside the
      // hours, and the batch email still running (not paused / deleted meanwhile).
      const sentToday = await countToday();
      if (sentToday === null || sentToday >= FORMS_PER_DAY) break;
      if (!isWithinWindow(new Date(), window)) break;
      const { data: still } = await db.from("call_campaigns").select("status").eq("id", c.id).maybeSingle();
      if ((still as { status?: string } | null)?.status !== "active") break;
      const s = await startSend(lead.id, { runId: run.id, senderEmail: box.email, subject: email.subject, message: email.body, offerKey: offer });
      if (!s.ok) {
        log.warn({ lead_id: lead.id, reason: s.reason }, "auto_form.send_refused");
        continue;
      }
      room--;
      await runSendStep(run.id);
      sent++;
      log.info({ lead_id: lead.id, campaign_id: c.id, run_id: run.id }, "auto_form.sent_attempt");
    }
  }
  return { sent, looked };
}
