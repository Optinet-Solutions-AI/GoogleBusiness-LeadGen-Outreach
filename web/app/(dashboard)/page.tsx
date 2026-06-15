/**
 * (dashboard)/page.tsx — Home / mission control.
 *
 * Inputs:  Supabase (server-side queries, parallelized) + lib/analytics.loadAnalytics()
 * Outputs: Editorial mission-control layout:
 *          - Hero "Needs You" card (top-left, dark, ember accent)
 *          - 6 metric cards (deployed / finished forms / active batches /
 *            closed this month / spend / pipeline value)
 *          - Outreach funnel (4 stages all-time: leads → texted → clicked → finished)
 *          - Activity feed (recent outreach events + stage changes)
 * Used by: route "/"
 *
 * Designed to answer "what's happening today?" at a glance for a non-technical
 * operator. Every number is clickable → routes to the filtered list. The dark
 * hero card keeps action items unmistakable even when the metric cards
 * compete for attention.
 */

import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { loadAnalytics } from "@/lib/analytics";
import { NewBatchButton } from "@/components/NewBatchButton";
import { PageHeader } from "@/components/ui/PageHeader";
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
  return {
    weekStart: monday.toISOString(),
    monthStart: startOfMonth.toISOString(),
  };
}

/**
 * Single Supabase round-trip for the home page. Group lead/stage queries into
 * one select-all-stages query and partition client-side — cheaper than 8
 * separate count queries.
 */
async function fetchHomeData() {
  const { weekStart, monthStart } = rangeAnchors();

  // Three independent reads — fire them in ONE Promise.all so the page does a
  // single parallel round-trip instead of three serial ones (cuts home TTFB ~3×).
  const [allLeads, allBatches, recentEvents] = await Promise.all([
    safeDb<LeadRow[]>(async (db) => {
      const { data } = await db
        .from("leads")
        .select("stage,updated_at,business_name")
        .neq("qualified", false)
        .limit(10000);
      return (data ?? []) as LeadRow[];
    }, []),
    safeDb<BatchRow[]>(async (db) => {
      const { data } = await db
        .from("batches")
        .select("status,estimated_cost_usd,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      return (data ?? []) as BatchRow[];
    }, []),
    safeDb<(OutreachRow & { business_name: string | null })[]>(async (db) => {
      const { data } = await db
        .from("outreach_events")
        .select("id,kind,lead_id,created_at,meta,leads(business_name)")
        .order("created_at", { ascending: false })
        .limit(12);
      return ((data ?? []) as unknown) as (OutreachRow & {
        business_name: string | null;
        leads?: { business_name: string | null };
      })[];
    }, []),
  ]);

  return { allLeads, allBatches, recentEvents, weekStart, monthStart };
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

  const [{ allLeads, allBatches, recentEvents, weekStart, monthStart }, analytics] =
    await Promise.all([fetchHomeData(), loadAnalytics()]);

  // ── Needs You counts ────────────────────────────────────────────────
  const replies = partition(allLeads, "replied");
  const needsEmail = partition(allLeads, "needs_email");
  const meetingsBooked = partition(allLeads, "meeting_booked");
  const activeBatches = allBatches.filter((b) => b.status === "running").length;

  // ── Metric values ──────────────────────────────────────────────────
  const sitesDeployedWeek = partition(allLeads, "deployed", weekStart);
  const finishedCount = analytics.funnel.find((s) => s.key === "finished")?.count ?? 0;

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

  // ── Outreach funnel (all-time) ────────────────────────────────────
  const VOICE_FUNNEL_KEYS: { key: string; href: string }[] = [
    { key: "leads",    href: "/leads" },
    { key: "texted",   href: "/inbox" },
    { key: "clicked",  href: "/inbox" },
    { key: "finished", href: "/inbox" },
  ];
  const byKey = new Map(analytics.funnel.map((s) => [s.key, s]));
  const funnel: FunnelStage[] = VOICE_FUNNEL_KEYS.map(({ key, href }) => {
    const step = byKey.get(key) ?? { key, label: key, count: 0 };
    return { key, label: step.label, count: step.count, href };
  });

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
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        title="Today"
        actions={<NewBatchButton />}
      />

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
          eyebrow="Finished"
          value={finishedCount}
          caption="from outreach"
          href="/inbox"
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
          href="/inbox"
        />
      </div>

      {/* Outreach funnel */}
      <FunnelChart
        stages={funnel}
        title="Conversion funnel · all time"
        caption={`${(byKey.get("leads")?.count ?? allLeads.length).toLocaleString()} qualified leads`}
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
