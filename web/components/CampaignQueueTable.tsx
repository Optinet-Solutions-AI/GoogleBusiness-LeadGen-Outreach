"use client";

/**
 * CampaignQueueTable.tsx — a campaign's lead queue: search, stage / membership /
 * send-state filters, sortable headers, paging.
 *
 * Inputs:  queue leads (campaign_leads joined to leads, pending-first) + the
 *          campaign's send timezone.
 * Outputs: rows link to the lead page; the business name opens the email thread.
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip, stageLabel, stageOrder } from "@/components/StageChip";
import { LeadThreadLink } from "@/components/inbox/LeadThreadLink";
import { countryLabel } from "@/lib/data/cities";
import { fmtInTz, relativeTime } from "@/lib/format";

export interface QueueLead {
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

const MEMBERSHIP_CHIP: Record<string, { label: string; cls: string; order: number }> = {
  pending:    { label: "Pending",    cls: "bg-surface-alt text-ink-muted border-rule",            order: 0 },
  called:     { label: "Called",     cls: "bg-action-soft text-action border-action/30",          order: 1 },
  sent:       { label: "Sent",       cls: "bg-action-soft text-action border-action/30",          order: 1 },
  interested: { label: "Interested", cls: "bg-positive-soft text-positive border-positive/30",    order: 2 },
  done:       { label: "Done",       cls: "bg-surface-alt text-ink-subtle border-rule",           order: 3 },
  skipped:    { label: "Skipped",    cls: "bg-warning-soft text-warning border-warning/30",       order: 4 },
};

/** The send state shown in "Next send", as a filterable value. */
function sendState(lead: QueueLead): string {
  if (lead.seq_status === "completed") return "completed";
  if (lead.seq_status === "stopped") return "stopped";
  if (lead.seq_status !== "active" || !lead.seq_next_step_at) return "on_launch";
  return new Date(lead.seq_next_step_at).getTime() <= Date.now() ? "due" : "scheduled";
}

const SEND_STATE_OPTIONS = [
  { value: "on_launch", label: "On launch" },
  { value: "due", label: "Due now" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Sequence done" },
  { value: "stopped", label: "Stopped" },
];

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

export function CampaignQueueTable({ leads, tz }: { leads: QueueLead[]; tz: string | null }) {
  const columns: DataColumn<QueueLead>[] = [
    {
      key: "business",
      label: "Business",
      width: "min-w-[220px]",
      sortValue: (l) => l.business_name,
      render: (lead) => (
        <>
          <LeadThreadLink
            leadId={lead.id}
            businessName={lead.business_name}
            subtitle={
              [cityFromAddress(lead.address), countryLabel(lead.country_code)].filter(Boolean).join(" · ") ||
              lead.category ||
              "—"
            }
          />
          <div className="mt-1">
            <LeadBadges lead={lead} />
          </div>
        </>
      ),
    },
    {
      key: "phone",
      label: "Phone",
      sortValue: (l) => l.phone,
      render: (lead) => (
        <span className="mono-num text-[13px] text-ink-muted">{lead.phone ?? <span className="text-ink-subtle">—</span>}</span>
      ),
    },
    {
      key: "stage",
      label: "Segment",
      sortValue: (l) => stageOrder(l.stage),
      filter: { label: "Stage", value: (l) => l.stage, labelFor: stageLabel },
      render: (lead) => <StageChip stage={lead.stage} />,
    },
    {
      key: "membership",
      label: "In campaign",
      sortValue: (l) => MEMBERSHIP_CHIP[l.membership_status]?.order ?? 99,
      filter: { label: "In campaign", value: (l) => l.membership_status, labelFor: (v) => MEMBERSHIP_CHIP[v]?.label ?? v },
      render: (lead) => <MembershipChip status={lead.membership_status} />,
    },
    {
      key: "next_send",
      label: "Next send",
      sortValue: (l) => (l.seq_status === "active" && l.seq_next_step_at ? new Date(l.seq_next_step_at).getTime() : null),
      filter: { label: "Next send", value: sendState, options: SEND_STATE_OPTIONS },
      render: (lead) => <NextSendCell lead={lead} tz={tz} />,
    },
    {
      key: "updated",
      label: "Updated",
      sortValue: (l) => l.updated_at,
      render: (lead) => <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(lead.updated_at)}</span>,
    },
    {
      key: "open",
      label: "",
      align: "right",
      width: "w-10",
      render: (lead) => (
        <Link href={`/leads/${lead.id}`} className="text-ink-subtle hover:text-ink transition-all inline-block">
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      rows={leads}
      columns={columns}
      getRowId={(l) => l.id}
      storageKey="campaign-queue.columnOrder.v1"
      noun="leads"
      empty="No leads in this campaign yet."
      search={{
        placeholder: "Search leads…",
        text: (l) => [l.business_name, l.address, l.phone, l.category, l.country_code].filter(Boolean).join(" "),
      }}
    />
  );
}

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
      <div className={`text-[12px] font-medium ${due ? "text-action" : "text-ink"}`}>{due ? "Due now" : future}</div>
      <div className="text-[10px] text-ink-subtle">{due ? `step ${step} · next tick` : `step ${step} · ${abs}`}</div>
    </div>
  );
}

function MembershipChip({ status }: { status: string }) {
  const chip = MEMBERSHIP_CHIP[status] ?? { label: status, cls: "bg-surface-alt text-ink-muted border-rule" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border leading-tight ${chip.cls}`}>
      {chip.label}
    </span>
  );
}
