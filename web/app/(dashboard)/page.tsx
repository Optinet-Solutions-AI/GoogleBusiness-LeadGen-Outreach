/**
 * (dashboard)/page.tsx — Home / mission control.
 *
 * Inputs:  Supabase (server-side queries, parallelized)
 * Outputs: Editorial mission-control layout:
 *          - Hero "Needs You" card (top-left, dark, ember accent)
 *          - 6 metric cards (deployed / reply rate / active batches /
 *            closed this month / spend / pipeline value)
 *          - Funnel chart (6 stages all-time)
 *          - Activity feed (recent outreach events + stage changes)
 * Used by: route "/"
 *
 * Designed to answer "what's happening today?" at a glance for a non-technical
 * operator. Every number is clickable → routes to the filtered list. The dark
 * hero card keeps action items unmistakable even when the metric cards
 * compete for attention.
 */

import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { NewBatchButton } from "@/components/NewBatchButton";
import { NeedsYouCard } from "@/components/NeedsYouCard";
import { MetricCard } from "@/components/MetricCard";
import { FunnelChart, type FunnelStage } from "@/components/FunnelChart";
import { ActivityFeed, type ActivityEvent } from "@/components/ActivityFeed";

export const dynamic = "force-dynamic";

interface LeadRow {
  stage: string;
  updated_at: string;
  business_name?: string | null;
}

interface BatchRow {
  status: string;
  estimated_cost_usd: number | null;
  created_at: string;
}

interface OutreachRow {
  id: string;
  kind: string;
  lead_id: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

/** Returns ISO start-of-week-Monday + start-of-month in UTC. */
function rangeAnchors() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)),
  );
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonday = new Date(monday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  return {
    weekStart: monday.toISOString(),
    monthStart: startOfMonth.toISOString(),
    lastWeekStart: lastMonday.toISOString(),
  };
}

/**
 * Single Supabase round-trip for the home page. Group lead/stage queries into
 * one select-all-stages query and partition client-side — cheaper than 8
 * separate count queries.
 */
async function fetchHomeData() {
  const { weekStart, monthStart, lastWeekStart } = rangeAnchors();

  const allLeads = await safeDb<LeadRow[]>(async (db) => {
    const { data } = await db
      .from("leads")
      .select("stage,updated_at,business_name")
      .neq("qualified", false)
      .limit(10000);
    return (data ?? []) as LeadRow[];
  }, []);

  const allBatches = await safeDb<BatchRow[]>(async (db) => {
    const { data } = await db
      .from("batches")
      .select("status,estimated_cost_usd,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    return (data ?? []) as BatchRow[];
  }, []);

  const recentEvents = await safeDb<(OutreachRow & { business_name: string | null })[]>(
    async (db) => {
      const { data } = await db
        .from("outreach_events")
        .select("id,kind,lead_id,created_at,meta,leads(business_name)")
        .order("created_at", { ascending: false })
        .limit(12);
      return ((data ?? []) as unknown) as (OutreachRow & {
        business_name: string | null;
        leads?: { business_name: string | null };
      })[];
    },
    [],
  );

  return { allLeads, allBatches, recentEvents, weekStart, monthStart, lastWeekStart };
}

function partition(leads: LeadRow[], stage: string, sinceIso?: string): number {
  return leads.filter(
    (l) => l.stage === stage && (!sinceIso || l.updated_at >= sinceIso),
  ).length;
}

export default async function HomePage() {
  if (!isDbConfigured()) {
    return (
      <EmptyShell title="Connect Supabase to see your dashboard">
        Set <code className="font-mono text-ink">SUPABASE_URL</code> and{" "}
        <code className="font-mono text-ink">SUPABASE_SERVICE_KEY</code> in your environment, then refresh.
      </EmptyShell>
    );
  }

  const { allLeads, allBatches, recentEvents, weekStart, monthStart, lastWeekStart } =
    await fetchHomeData();

  // ── Needs You counts ────────────────────────────────────────────────
  const replies = partition(allLeads, "replied");
  const needsEmail = partition(allLeads, "needs_email");
  const meetingsBooked = partition(allLeads, "meeting_booked");
  const activeBatches = allBatches.filter((b) => b.status === "running").length;

  // ── Metric values ──────────────────────────────────────────────────
  const sitesDeployedWeek = partition(allLeads, "deployed", weekStart);
  const outreachedWeek = partition(allLeads, "outreached", weekStart);
  const repliedWeek = partition(allLeads, "replied", weekStart);
  const repliedLastWeek = allLeads.filter(
    (l) => l.stage === "replied" && l.updated_at >= lastWeekStart && l.updated_at < weekStart,
  ).length;
  const outreachedLastWeek = allLeads.filter(
    (l) => l.stage === "outreached" && l.updated_at >= lastWeekStart && l.updated_at < weekStart,
  ).length;
  const replyRateWeek = outreachedWeek > 0 ? (repliedWeek / outreachedWeek) * 100 : 0;
  const replyRateLastWeek = outreachedLastWeek > 0 ? (repliedLastWeek / outreachedLastWeek) * 100 : 0;
  const replyRateDelta = +(replyRateWeek - replyRateLastWeek).toFixed(1);

  const closedThisMonth = allLeads.filter(
    (l) => l.stage === "closed_won" && l.updated_at >= monthStart,
  ).length;
  const ASSUMED_MRR_PER_DEAL = 149; // displayed assumption when DB doesn't carry MRR
  const projectedMrr = closedThisMonth * ASSUMED_MRR_PER_DEAL;

  const spendThisWeek = allBatches
    .filter((b) => b.created_at >= weekStart)
    .reduce((sum, b) => sum + (b.estimated_cost_usd ?? 0), 0);
  const MONTHLY_CAP = 50; // configurable — surfaced as a guard rail visual

  const pipelineValue = replies * ASSUMED_MRR_PER_DEAL;

  // ── Funnel ─────────────────────────────────────────────────────────
  const funnel: FunnelStage[] = [
    { key: "scraped",    label: "Scraped",   count: partition(allLeads, "scraped")  + allLeads.filter((l) => !["scraped"].includes(l.stage)).length },
    { key: "enriched",   label: "Enriched",  count: allLeads.filter((l) => !["scraped"].includes(l.stage)).length },
    { key: "deployed",   label: "Live",      count: allLeads.filter((l) => ["deployed","outreached","replied","meeting_booked","meeting_done","improved","handed_over","closed_won"].includes(l.stage)).length },
    { key: "outreached", label: "Sent",      count: allLeads.filter((l) => ["outreached","replied","meeting_booked","meeting_done","improved","handed_over","closed_won"].includes(l.stage)).length },
    { key: "replied",    label: "Replied",   count: allLeads.filter((l) => ["replied","meeting_booked","meeting_done","improved","handed_over","closed_won"].includes(l.stage)).length },
    { key: "closed_won", label: "Won",       count: allLeads.filter((l) => l.stage === "closed_won").length },
  ];
  // Re-anchor "Scraped" to total leads (all stages are downstream of scraped)
  funnel[0].count = allLeads.length;
  funnel[1].count = allLeads.filter((l) => l.stage !== "scraped").length;

  // ── Activity feed ──────────────────────────────────────────────────
  const events: ActivityEvent[] = recentEvents.map((e) => {
    const obj = e as unknown as OutreachRow & {
      business_name: string | null;
      leads?: { business_name: string | null } | null;
    };
    return {
      id: obj.id,
      kind: obj.kind,
      lead_id: obj.lead_id,
      business_name: obj.leads?.business_name ?? obj.business_name ?? null,
      ts: obj.created_at,
      meta: obj.meta,
    };
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 mb-2">
        <div>
          <div className="eyebrow mb-2">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
          <h1 className="editorial-head text-ink text-[34px] md:text-[40px] leading-none">
            Today
          </h1>
        </div>
        <NewBatchButton />
      </header>

      {/* Top grid: hero card (col 1, spans 2 rows) + 6 metric cards (cols 2-4, 2 rows) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <NeedsYouCard
          replies={replies}
          needsEmail={needsEmail}
          meetingsBooked={meetingsBooked}
          activeBatches={activeBatches}
        />

        <MetricCard
          eyebrow="Sites deployed"
          value={sitesDeployedWeek}
          caption="this week"
          href="/leads?stage=deployed"
        />
        <MetricCard
          eyebrow="Reply rate"
          value={replyRateWeek.toFixed(1)}
          suffix="%"
          delta={
            replyRateDelta !== 0
              ? {
                  value: `${Math.abs(replyRateDelta)}pp`,
                  direction: replyRateDelta > 0 ? "up" : "down",
                  vs: "vs last wk",
                  tone: replyRateDelta > 0 ? "positive" : "warning",
                }
              : undefined
          }
          caption={replyRateDelta === 0 ? "this week" : undefined}
        />
        <MetricCard
          eyebrow="Active batches"
          value={activeBatches}
          caption={activeBatches === 1 ? "running now" : activeBatches > 1 ? "running now" : "none in flight"}
          href="/batches?status=running"
        />

        <MetricCard
          eyebrow="Closed this month"
          value={closedThisMonth}
          caption={projectedMrr > 0 ? `≈ $${projectedMrr.toLocaleString()}/mo MRR` : "no closes yet"}
          href="/leads?stage=closed_won"
        />
        <MetricCard
          eyebrow="Spend this week"
          value={spendThisWeek.toFixed(2)}
          prefix="$"
          caption={`$${spendThisWeek.toFixed(2)} / $${MONTHLY_CAP} cap`}
          delta={
            spendThisWeek > MONTHLY_CAP * 0.75
              ? { value: "near cap", direction: "up", tone: "warning" }
              : undefined
          }
        />
        <MetricCard
          eyebrow="Pipeline value"
          value={pipelineValue.toLocaleString()}
          prefix="$"
          caption={`${replies} replies × $${ASSUMED_MRR_PER_DEAL} avg`}
          href="/replies"
        />
      </div>

      {/* Funnel */}
      <FunnelChart
        stages={funnel}
        caption={`${allLeads.length.toLocaleString()} leads tracked`}
      />

      {/* Activity feed */}
      <ActivityFeed events={events} />
    </div>
  );
}

function EmptyShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center">
      <h1 className="editorial-head text-ink text-3xl mb-4">{title}</h1>
      <p className="text-ink-muted text-[14px] leading-relaxed">{children}</p>
    </div>
  );
}
