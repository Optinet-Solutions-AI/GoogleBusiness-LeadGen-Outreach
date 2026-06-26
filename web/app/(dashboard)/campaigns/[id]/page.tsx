/**
 * (dashboard)/campaigns/[id]/page.tsx — Campaign detail: member queue + metrics strip.
 *
 * Inputs:  call_campaigns row + campaign_leads joined to leads via safeDb;
 *          loadCampaignAnalytics(id) for funnel/stats
 * Outputs: header + metrics strip + funnel + queue table
 * Used by: route "/campaigns/[id]"
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { loadCampaignAnalytics } from "@/lib/analytics";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { StatCard } from "@/components/StatCard";
import { FunnelChart, type FunnelStage } from "@/components/FunnelChart";
import { CampaignStatusActions } from "@/components/CampaignStatusActions";
import { EmailCampaignControls } from "@/components/EmailCampaignControls";
import { CampaignEmailPreview } from "@/components/CampaignEmailPreview";
import { LeadThreadLink } from "@/components/inbox/LeadThreadLink";
import { resolveSegment, type CallSegment } from "@/lib/segment";
import { countryLabel } from "@/lib/data/cities";
import { relativeTime } from "@/lib/format";
import { nextSlot, type SendWindow } from "@/lib/campaigns/send-window";

export const dynamic = "force-dynamic";

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  channel: string | null;
  source: string;
  segment: string | null;
  country_code: string | null;
  category: string | null;
  batch_id: string | null;
  target_count: number | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  timezone: string | null;
  sender_email: string | null;
  copy_overrides: Record<string, { subject?: string | null; body?: string | null }> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface QueueLead {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  phone: string | null;
  stage: string;
  call_segment: string | null;
  primary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  website_kind: WebsiteKind | null;
  demo_url: string | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  updated_at: string;
  /** Sequence state (migration 034) — the real per-lead send schedule. */
  seq_status: string | null;
  seq_step: number | null;
  seq_next_step_at: string | null;
  /** Membership status from campaign_leads */
  membership_status: string;
}

// ── Funnel keys for the chart ─────────────────────────────────────────────────

const CHART_KEYS: { key: string; href: string }[] = [
  { key: "leads",    href: "/leads" },
  { key: "texted",   href: "/inbox" },
  { key: "clicked",  href: "/inbox" },
  { key: "finished", href: "/inbox" },
];

// ── Membership status sort order ──────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  pending:    0,
  called:     1,
  interested: 2,
  done:       3,
  skipped:    4,
};

function membershipOrder(s: string): number {
  return STATUS_ORDER[s] ?? 99;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

/** Human-readable schedule window string, e.g. "Mon–Fri 9:00–20:00 America/New_York" */
function scheduleLabel(c: Campaign): string {
  const days = (() => {
    const d = c.call_days ?? [1, 2, 3, 4, 5];
    const sorted = [...d].sort((a, b) => a - b);
    const DAY = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    if (sorted.length === 5 && sorted.join(",") === "1,2,3,4,5") return "Mon–Fri";
    if (sorted.length === 7) return "Every day";
    return sorted.map((n) => DAY[(n - 1) % 7] ?? `${n}`).join(", ");
  })();
  const hours =
    c.call_start_hour !== null && c.call_end_hour !== null
      ? `${c.call_start_hour}:00–${c.call_end_hour}:00`
      : null;
  return [days, hours, c.timezone].filter(Boolean).join(" · ");
}

/** Build the SendWindow used by the scheduler from a campaign row. */
function windowOf(c: Campaign): SendWindow {
  return {
    tz: c.timezone ?? "America/New_York",
    days: c.call_days ?? [1, 2, 3, 4, 5],
    startHour: c.call_start_hour ?? 9,
    endHour: c.call_end_hour ?? 20,
  };
}

/** "Mon, Jun 30, 9:14 AM EDT" — an instant rendered in the campaign's timezone. */
function fmtInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Projected send date per step (Day 0/4/8/12), each pushed into the next valid
 *  window slot — the same math the scheduler uses, so the dates are real. */
function projectStepDates(c: Campaign, now: Date): Record<number, string> {
  const w = windowOf(c);
  const OFFSET_DAYS: Record<number, number> = { 1: 0, 2: 4, 3: 8, 4: 12 };
  const out: Record<number, string> = {};
  for (const step of [1, 2, 3, 4]) {
    const after = new Date(now.getTime() + OFFSET_DAYS[step] * 86_400_000);
    out[step] = fmtInTz(nextSlot({ after, window: w, seed: c.id }), w.tz);
  }
  return out;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">
          Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load campaign detail.
        </p>
      </div>
    );
  }

  // Campaign, members, analytics + mailboxes are all keyed on the campaign id —
  // fetch them together instead of in a waterfall. Mailboxes is cheap; fetched
  // unconditionally and only used when the channel is email.
  type RawMember = { status: string; leads: unknown };
  const [campaign, rawMembers, a, mailboxes] = await Promise.all([
    safeDb<Campaign | null>(async (db) => {
      const { data } = await db.from("call_campaigns").select("*").eq("id", params.id).single();
      return data as Campaign | null;
    }, null),
    safeDb<RawMember[]>(async (db) => {
      const { data } = await db
        .from("campaign_leads")
        .select(
          "status,leads(id,business_name,address,country_code,category,phone,stage," +
            "call_segment,primary_offer,needs_improvement,website_score," +
            "website_kind,demo_url,business_status,is_service_area_only,is_franchise_flagged," +
            "category_off_niche,updated_at,seq_status,seq_step,seq_next_step_at)",
        )
        .eq("campaign_id", params.id)
        .limit(2000);
      return (data ?? []) as unknown as RawMember[];
    }, [] as RawMember[]),
    loadCampaignAnalytics(params.id),
    safeDb<{ email: string; from_name: string | null }[]>(async (db) => {
      const { data } = await db
        .from("email_accounts")
        .select("email,from_name")
        .eq("status", "active")
        .not("smtp_host", "is", null)
        .order("created_at", { ascending: true });
      return (data ?? []) as { email: string; from_name: string | null }[];
    }, []),
  ]);
  if (!campaign) notFound();

  // Flatten membership rows; guard for null leads (referential integrity edge case)
  const leads: QueueLead[] = (rawMembers as unknown as Array<{ status: string; leads: Record<string, unknown> | null }>)
    .filter((r) => r.leads !== null)
    .map((r) => ({
      ...(r.leads as Omit<QueueLead, "membership_status">),
      membership_status: r.status,
    }));

  // Sort: pending first (active work), then done/skipped
  leads.sort((a, b) => membershipOrder(a.membership_status) - membershipOrder(b.membership_status));

  // Projected send schedule (real window math) — so the operator sees WHEN each
  // email actually goes out, not just the window rules.
  const stepDates = projectStepDates(campaign, new Date());

  // Analytics (fetched above, in parallel)
  const byKey = new Map(a.funnel.map((s) => [s.key, s]));
  const chartStages: FunnelStage[] = CHART_KEYS.map(({ key, href }) => {
    const step = byKey.get(key) ?? { key, label: key, count: 0 };
    return { key, label: step.label, count: step.count, href };
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <nav className="flex items-center text-[11px] font-mono uppercase tracking-[0.14em] text-ink-subtle mb-2">
            <Link href="/campaigns" className="hover:text-ink transition-colors">
              Campaigns
            </Link>
            <span className="mx-2">/</span>
            <span className="text-ink-muted">{campaign.id.slice(0, 8)}</span>
          </nav>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
            {campaign.name}
          </h1>
          <p className="text-[12px] text-ink-subtle font-mono mt-1">{scheduleLabel(campaign)}</p>
        </div>
        <div className="flex items-center gap-3 md:mt-1">
          <CampaignStatusActions id={campaign.id} status={campaign.status} />
        </div>
      </header>

      {campaign.channel === "email" && (
        <EmailCampaignControls
          campaignId={campaign.id}
          campaignName={campaign.name}
          status={campaign.status}
          mailboxes={mailboxes}
          firstSendLabel={stepDates[1]}
        />
      )}

      {campaign.channel === "email" && (
        <CampaignEmailPreview
          segment={
            (campaign.segment as CallSegment | null) ??
            (leads[0] ? resolveSegment(leads[0]) : "no_website")
          }
          sample={{
            business_name: leads[0]?.business_name ?? "Sample Business",
            demo_url: leads[0]?.demo_url ?? null,
          }}
          overrides={campaign.copy_overrides}
          stepDates={stepDates}
        />
      )}

      {/* Metrics strip */}
      <section>
        <p className="eyebrow mb-3">Campaign metrics</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Leads"
            value={byKey.get("leads")?.count ?? leads.length}
            hint="in campaign"
          />
          <StatCard
            label="Texted"
            value={byKey.get("texted")?.count ?? 0}
            emphasis
            hint={(() => {
              const total = byKey.get("leads")?.count ?? leads.length;
              const texted = byKey.get("texted")?.count ?? 0;
              return total > 0 ? `${Math.round((texted / total) * 100)}% of leads` : undefined;
            })()}
          />
          <StatCard
            label="Clicked"
            value={byKey.get("clicked")?.count ?? 0}
          />
          <StatCard
            label="Finished"
            value={byKey.get("finished")?.count ?? 0}
            hintTone="positive"
            hint={byKey.get("finished")?.count ? "form submitted" : undefined}
          />
        </div>
      </section>

      {/* Funnel chart */}
      {!a.is_empty && (
        <FunnelChart
          stages={chartStages}
          title="Conversion funnel"
          caption={`${a.rates.overall ?? 0}% lead→finished`}
        />
      )}
      {a.is_empty && leads.length > 0 && (
        <div className="rounded bg-action-soft border border-action/30 px-4 py-3 text-[13px] text-action">
          <span className="font-bold">No messages sent yet.</span>{" "}
          Launch the campaign or start an outreach sequence to begin tracking.
        </div>
      )}

      {/* Queue table */}
      <section className="bg-surface border border-rule rounded-lg overflow-clip">
        <div className="px-4 py-3 border-b border-rule flex items-center gap-2">
          <h2 className="eyebrow">Lead queue</h2>
          <span className="ml-auto mono-num text-[11px] bg-surface-alt px-2 py-0.5 rounded text-ink-muted">
            {leads.length}
          </span>
        </div>

        {leads.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-muted">
            No leads in this campaign yet.
          </p>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
              <tr>
                <Th>Business</Th>
                <Th>Phone</Th>
                <Th>Segment</Th>
                <Th>In campaign</Th>
                <Th>Next send</Th>
                <Th>Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-surface-alt transition-colors group">
                  <td className="px-4 py-2.5">
                    <LeadThreadLink
                      leadId={lead.id}
                      businessName={lead.business_name}
                      subtitle={
                        [cityFromAddress(lead.address), countryLabel(lead.country_code)]
                          .filter(Boolean)
                          .join(" · ") ||
                        lead.category ||
                        "—"
                      }
                    />
                    <div className="mt-1">
                      <LeadBadges lead={lead} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted">
                    {lead.phone ?? <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <StageChip stage={lead.stage} />
                  </td>
                  <td className="px-4 py-2.5">
                    <MembershipChip status={lead.membership_status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <NextSendCell lead={lead} tz={campaign.timezone} />
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">
                    {relativeTime(lead.updated_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-ink-subtle hover:text-ink group-hover:translate-x-0.5 transition-all inline-block"
                    >
                      <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th
      className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}
    >
      {children}
    </th>
  );
}

const MEMBERSHIP_CHIP: Record<string, { label: string; cls: string }> = {
  pending:    { label: "Pending",    cls: "bg-surface-alt text-ink-muted border-rule" },
  called:     { label: "Called",     cls: "bg-action-soft text-action border-action/30" },
  interested: { label: "Interested", cls: "bg-positive-soft text-positive border-positive/30" },
  done:       { label: "Done",       cls: "bg-surface-alt text-ink-subtle border-rule" },
  skipped:    { label: "Skipped",    cls: "bg-warning-soft text-warning border-warning/30" },
  sent:       { label: "Sent",       cls: "bg-action-soft text-action border-action/30" },
};

/**
 * Per-lead next-send time. Before launch a lead isn't enrolled (no seq state) →
 * "On launch". Once active, seq_next_step_at is the real scheduled instant: in
 * the past = due on the next tick inside the window; future = the follow-up date.
 */
function NextSendCell({ lead, tz }: { lead: QueueLead; tz: string | null }) {
  const zone = tz ?? "America/New_York";
  const status = lead.seq_status;

  if (status === "completed") {
    return <span className="text-[11px] text-ink-subtle">Sequence done</span>;
  }
  if (status === "stopped") {
    return <span className="text-[11px] text-ink-subtle">Stopped</span>;
  }
  if (status !== "active" || !lead.seq_next_step_at) {
    return <span className="text-[11px] text-ink-subtle">On launch</span>;
  }

  const at = new Date(lead.seq_next_step_at);
  const due = at.getTime() <= Date.now();
  const abs = fmtInTz(at, zone);
  const step = (lead.seq_step ?? 0) + 1; // seq_step is the LAST sent step; next is +1

  // Forward-looking relative label (relativeTime only handles the past).
  const future = (() => {
    const s = Math.floor((at.getTime() - Date.now()) / 1000);
    if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))}m`;
    if (s < 86_400) return `in ${Math.floor(s / 3600)}h`;
    return `in ${Math.floor(s / 86_400)}d`;
  })();

  return (
    <div className="leading-tight" title={abs}>
      <div className={`text-[12px] font-medium ${due ? "text-action" : "text-ink"}`}>
        {due ? "Due now" : future}
      </div>
      <div className="text-[10px] text-ink-subtle">
        {due ? `step ${step} · next tick` : `step ${step} · ${abs}`}
      </div>
    </div>
  );
}

function MembershipChip({ status }: { status: string }) {
  const chip = MEMBERSHIP_CHIP[status] ?? { label: status, cls: "bg-surface-alt text-ink-muted border-rule" };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border leading-tight ${chip.cls}`}
    >
      {chip.label}
    </span>
  );
}
