/**
 * (dashboard)/status/page.tsx — Weekly status.
 *
 * Inputs:  Supabase rows — batches, leads, outreach_events (read-only, scoped to this ISO week)
 * Outputs: top-line numbers + a plain-English weekly summary generated from the data.
 *          Fully self-contained — no markdown file and no Claude Code skill required.
 * Used by: route "/status"
 */

import Link from "next/link";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function weekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
}

type WeekNumbers = {
  batches: number;
  leads: number;
  sites: number;
  emails: number;
  sms: number;
  replies: number;
};

async function getNumbers(): Promise<WeekNumbers> {
  const since = weekStart().toISOString();
  const zero: WeekNumbers = { batches: 0, leads: 0, sites: 0, emails: 0, sms: 0, replies: 0 };

  return safeDb<WeekNumbers>(async (db) => {
    const [batches, leadsScraped, sitesDeployed, emails, sms, replies] = await Promise.all([
      db.from("batches").select("id", { count: "exact", head: true }).gte("created_at", since),
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since),
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .not("demo_url", "is", null),
      // Outreach + replies are event-based (when it happened), not lead-creation based —
      // a lead scraped weeks ago can be emailed or reply *this* week.
      db.from("outreach_events").select("id", { count: "exact", head: true }).gte("created_at", since).eq("kind", "email_sent"),
      db.from("outreach_events").select("id", { count: "exact", head: true }).gte("created_at", since).eq("kind", "sms_sent"),
      db.from("outreach_events").select("id", { count: "exact", head: true }).gte("created_at", since).eq("kind", "replied"),
    ]);
    return {
      batches: batches.count ?? 0,
      leads: leadsScraped.count ?? 0,
      sites: sitesDeployed.count ?? 0,
      emails: emails.count ?? 0,
      sms: sms.count ?? 0,
      replies: replies.count ?? 0,
    };
  }, zero);
}

/** Plain-English bullets describing what happened this week, derived from the counts. */
function buildSummary(n: WeekNumbers): string[] {
  const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);
  const lines: string[] = [];
  if (n.batches) lines.push(`${n.batches} ${plural(n.batches, "batch", "batches")} run`);
  if (n.leads) lines.push(`${n.leads} new ${plural(n.leads, "lead")} scraped`);
  if (n.sites) lines.push(`${n.sites} demo ${plural(n.sites, "site")} deployed`);
  const sent = n.emails + n.sms;
  if (sent) {
    const parts: string[] = [];
    if (n.emails) parts.push(`${n.emails} email`);
    if (n.sms) parts.push(`${n.sms} SMS`);
    lines.push(`${sent} outreach ${plural(sent, "message")} sent (${parts.join(", ")})`);
  }
  if (n.replies) lines.push(`${n.replies} ${plural(n.replies, "reply", "replies")} received`);
  return lines;
}

export default async function StatusPage() {
  const week = isoWeek();
  const configured = isDbConfigured();
  const numbers = await getNumbers();
  const summary = buildSummary(numbers);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <p className="eyebrow mb-2">Weekly report</p>
        <h1 className="editorial-head text-ink text-[26px] sm:text-[32px] md:text-[36px] leading-none">
          Status
        </h1>
        <p className="mono-num text-[12px] text-ink-muted mt-2">Week {week}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Batches" value={numbers.batches} hint="this week" />
        <StatCard label="Leads scraped" value={numbers.leads} hint="this week" />
        <StatCard label="Sites deployed" value={numbers.sites} emphasis hint="this week" />
        <StatCard label="Replies" value={numbers.replies} hintTone="positive" hint="this week" />
      </div>

      <section className="bg-surface border border-rule rounded-lg p-4 sm:p-6">
        <h2 className="eyebrow mb-4">This week so far</h2>

        {!configured ? (
          <p className="text-[13px] text-ink-muted leading-relaxed">
            Connect Supabase (set <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_URL</code>{" "}
            and <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_SERVICE_KEY</code>) and this
            summary fills in automatically from your pipeline activity.
          </p>
        ) : summary.length > 0 ? (
          <ul className="space-y-2">
            {summary.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[13px] sm:text-[14px] text-ink leading-relaxed">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-muted leading-relaxed">
            Nothing logged this week yet. This summary updates on its own as the pipeline runs — kick one off
            from the{" "}
            <Link href="/batches" className="text-action hover:underline">
              Batches
            </Link>{" "}
            page and the numbers above will start filling in.
          </p>
        )}
      </section>
    </div>
  );
}
