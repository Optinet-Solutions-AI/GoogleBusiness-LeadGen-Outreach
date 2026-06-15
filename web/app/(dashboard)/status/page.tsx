/**
 * (dashboard)/status/page.tsx — Weekly / monthly / yearly status.
 *
 * Inputs:  searchParams { period?, offset? } + Supabase rows (batches, leads,
 *          outreach_events) scoped to the resolved [start, end) window.
 * Outputs: top-line numbers + a plain-English summary for the selected period,
 *          with Week/Month/Year + prev/next navigation. No markdown file, no
 *          Claude Code dependency.
 * Used by: route "/status"
 */

import Link from "next/link";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { StatCard } from "@/components/StatCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PeriodStepper } from "@/components/ui/PeriodStepper";
import { buildFilterUrl } from "@/lib/url-params";
import { parsePeriod, parseOffset, resolvePeriod, type PeriodKind } from "@/lib/period";

export const dynamic = "force-dynamic";

type PeriodNumbers = {
  batches: number;
  leads: number;
  sites: number;
  emails: number;
  sms: number;
  replies: number;
};

async function getNumbers(start: string, end: string): Promise<PeriodNumbers> {
  const zero: PeriodNumbers = { batches: 0, leads: 0, sites: 0, emails: 0, sms: 0, replies: 0 };

  return safeDb<PeriodNumbers>(async (db) => {
    // Scope every count to the [start, end) window (closed-open).
    const range = <T,>(qb: T): T => (qb as any).gte("created_at", start).lt("created_at", end);
    const [batches, leadsScraped, sitesDeployed, emails, sms, replies] = await Promise.all([
      range(db.from("batches").select("id", { count: "exact", head: true })),
      range(db.from("leads").select("id", { count: "exact", head: true })),
      range(db.from("leads").select("id", { count: "exact", head: true })).not("demo_url", "is", null),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "email_sent"),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "sms_sent"),
      range(db.from("outreach_events").select("id", { count: "exact", head: true })).eq("kind", "replied"),
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

/** Plain-English bullets describing what happened in the period. */
function buildSummary(n: PeriodNumbers): string[] {
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

const PERIOD_WORD: Record<PeriodKind, string> = { week: "week", month: "month", year: "year" };

export default async function StatusPage({
  searchParams,
}: {
  searchParams: { period?: string; offset?: string };
}) {
  const period = parsePeriod(searchParams.period);
  const offset = parseOffset(searchParams.offset);
  const resolved = resolvePeriod(period, offset, new Date());

  const configured = isDbConfigured();
  const numbers = await getNumbers(resolved.start, resolved.end);
  const summary = buildSummary(numbers);

  // Switching period always resets to the current window (offset 0).
  const segHref = (p: PeriodKind) =>
    buildFilterUrl("/status", {}, { period: p === "week" ? undefined : p });
  const segOptions = [
    { value: "week", label: "Week", href: segHref("week") },
    { value: "month", label: "Month", href: segHref("month") },
    { value: "year", label: "Year", href: segHref("year") },
  ];

  // Stepper hrefs keep the current period, vary the offset.
  const stepHref = (o: number) =>
    buildFilterUrl("/status", {}, {
      period: period === "week" ? undefined : period,
      offset: o === 0 ? undefined : String(o),
    });
  const prevHref = stepHref(offset - 1);
  const nextHref = offset >= 0 ? null : stepHref(offset + 1);
  const resetHref = resolved.isCurrent ? null : stepHref(0);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <p className="eyebrow mb-2">Status report</p>
        <h1 className="editorial-head text-ink text-[26px] sm:text-[32px] md:text-[36px] leading-none">
          Status
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <SegmentedControl options={segOptions} active={period} />
          <PeriodStepper
            label={resolved.label}
            prevHref={prevHref}
            nextHref={nextHref}
            resetHref={resetHref}
            resetLabel={`This ${PERIOD_WORD[period]}`}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Batches" value={numbers.batches} hint={resolved.label} />
        <StatCard label="Leads scraped" value={numbers.leads} hint={resolved.label} />
        <StatCard label="Sites deployed" value={numbers.sites} emphasis hint={resolved.label} />
        <StatCard label="Replies" value={numbers.replies} hintTone="positive" hint={resolved.label} />
      </div>

      <section className="bg-surface border border-rule rounded-lg p-4 sm:p-6">
        <h2 className="eyebrow mb-4">
          {resolved.isCurrent ? `This ${PERIOD_WORD[period]} so far` : resolved.label}
        </h2>

        {!configured ? (
          <p className="text-[13px] text-ink-muted leading-relaxed">
            Connect Supabase (set{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_URL</code>{" "}
            and{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">SUPABASE_SERVICE_KEY</code>
            ) and this summary fills in automatically from your pipeline activity.
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
            Nothing logged for this {PERIOD_WORD[period]}.{" "}
            {resolved.isCurrent ? (
              <>
                This summary updates on its own as the pipeline runs — kick one off from the{" "}
                <Link href="/batches" className="text-action hover:underline">
                  Batches
                </Link>{" "}
                page and the numbers above will start filling in.
              </>
            ) : (
              <>Try a different period, or step back to the current one.</>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
