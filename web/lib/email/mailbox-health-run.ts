/**
 * email/mailbox-health-run.ts — the automation tick's "mailboxHealth" part: pause any active mailbox whose hard bounces
 * or spam complaints climbed (27 Nov 2026, workflow watch_mailbox_health.md).
 *
 * Inputs:  active email_accounts (+ resumed_at, migration 077), their sends (email_messages outbound 'sent'), the hard
 *          bounces / spam complaints recorded on leads (outreach_events email_bounced {bounceKind:'hard'} /
 *          email_complaint)
 * Outputs: email_accounts status 'paused' + paused_reason / paused_at / paused_by 'auto'; a summary
 *          { checked, paused[] } or { skipped } (077 missing)
 * Used by: lib/automation/tick.ts (Cloud Run MODE=automation, every 15 minutes)
 *
 * Rules: lib/email/mailbox-health.ts. A paused mailbox stays paused until the operator presses Resume (operator,
 * 27 Nov 2026): nothing here ever resumes one. The pause is conditional on the mailbox still being active, so two runs
 * never overwrite each other's reason. Free (no paid calls).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { healthVerdict, tallyMailbox, windowDays, windowStart, type HealthEvent, type HealthSend } from "./mailbox-health";

const log = getLogger("mailbox-health");
const DAY_MS = 86_400_000;
/** Sends this far before the window still own a bounce that lands inside it. */
const ATTRIBUTION_LOOKBACK_MS = 14 * DAY_MS;
const MISSING_077 = "Run database update 077 (mailbox auto-pause).";

export interface HealthDeps {
  mailboxes(): Promise<{ id: string; email: string; resumed_at: string | null }[]>;
  sends(emails: string[], since: string): Promise<HealthSend[]>;
  events(since: string): Promise<HealthEvent[]>;
  /** true when this call paused it (it was still active). */
  pause(id: string, reason: string, at: string): Promise<boolean>;
}

async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

const realDeps: HealthDeps = {
  mailboxes: async () => {
    const { data, error } = await getDb().from("email_accounts").select("id,email,resumed_at").eq("status", "active");
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; email: string; resumed_at: string | null }[];
  },
  sends: async (emails, since) => {
    const rows = await paged<{ lead_id: string | null; from_addr: string | null; created_at: string }>((from, to) =>
      getDb()
        .from("email_messages")
        .select("lead_id,from_addr,created_at")
        .eq("direction", "outbound")
        .eq("status", "sent")
        .in("from_addr", emails)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    return rows.filter((r) => r.lead_id && r.from_addr).map((r) => ({ lead_id: r.lead_id!, from: r.from_addr!, at: r.created_at }));
  },
  events: async (since) => {
    const rows = await paged<{ lead_id: string | null; kind: string; created_at: string; bounce_kind: string | null }>((from, to) =>
      getDb()
        .from("outreach_events")
        .select("lead_id,kind,created_at,bounce_kind:meta->>bounceKind")
        .in("kind", ["email_bounced", "email_complaint"])
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    return rows
      .filter((r) => r.lead_id && (r.kind === "email_complaint" || r.bounce_kind === "hard"))
      .map((r) => ({ lead_id: r.lead_id!, kind: r.kind === "email_complaint" ? ("complaint" as const) : ("bounce" as const), at: r.created_at }));
  },
  pause: async (id, reason, at) => {
    const { data, error } = await getDb()
      .from("email_accounts")
      .update({ status: "paused", paused_reason: reason, paused_at: at, paused_by: "auto" })
      .eq("id", id)
      .eq("status", "active")
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },
};

export async function checkMailboxHealth(
  now: number = Date.now(),
  deps: HealthDeps = realDeps,
): Promise<{ checked: number; paused: { email: string; reason: string }[] } | { skipped: string }> {
  let boxes: Awaited<ReturnType<HealthDeps["mailboxes"]>>;
  try {
    boxes = await deps.mailboxes();
  } catch (err) {
    if (/resumed_at|paused_/.test(String(err))) return { skipped: MISSING_077 };
    throw err;
  }
  if (!boxes.length) return { checked: 0, paused: [] };

  const nowDate = new Date(now);
  const starts = boxes.map((b) => windowStart(nowDate, b.resumed_at));
  const earliest = new Date(Math.min(...starts.map((d) => d.getTime())));
  const [sends, events] = await Promise.all([
    deps.sends(boxes.map((b) => b.email), new Date(earliest.getTime() - ATTRIBUTION_LOOKBACK_MS).toISOString()),
    deps.events(earliest.toISOString()),
  ]);

  const paused: { email: string; reason: string }[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const verdict = healthVerdict(tallyMailbox(b.email, starts[i], sends, events), windowDays(nowDate, starts[i]));
    if (!verdict.pause) continue;
    if (await deps.pause(b.id, verdict.reason, nowDate.toISOString())) {
      paused.push({ email: b.email, reason: verdict.reason });
      log.warn({ mailbox: b.email, reason: verdict.reason }, "mailbox_health.paused");
    }
  }
  return { checked: boxes.length, paused };
}
