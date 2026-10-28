"use client";

/**
 * CampaignsTable.tsx — campaigns list: search, channel/segment/country/status
 * filters, sortable headers, paging, sticky header + draggable columns.
 *
 * Inputs:  rows (precomputed, serializable) from the server campaigns page.
 * Used by: app/(dashboard)/campaigns/page.tsx
 */

import { useRouter } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { CampaignRowActions } from "@/components/CampaignRowActions";

export interface CampaignTableRow {
  id: string;
  name: string;
  source: string;
  channel: string | null;
  segment: string | null;
  country_code: string | null;
  category: string | null;
  status: string;
  total: number;
  contacted: number;
  interested: number;
}

const SEGMENT_META: Record<string, { label: string; tone: string }> = {
  no_website: { label: "Build", tone: "text-positive" },
  old_website: { label: "Improve", tone: "text-warning" },
  has_website: { label: "Menu", tone: "text-action" },
};
const CHANNEL_META: Record<string, { label: string; tone: string }> = {
  email: { label: "Email", tone: "text-action" },
  sms: { label: "SMS", tone: "text-positive" },
  dm: { label: "DM", tone: "text-warning" },
  call: { label: "AI call", tone: "text-action" },
};
const STATUS_TONE: Record<string, string> = {
  active: "text-positive",
  building: "text-action",
  paused: "text-warning",
  done: "text-ink-muted",
  draft: "text-ink-muted",
};

function successRate(c: CampaignTableRow): string {
  if (c.contacted <= 0) return "—";
  return `${Math.round((c.interested / c.contacted) * 100)}%`;
}

export function CampaignsTable({ rows }: { rows: CampaignTableRow[] }) {
  const router = useRouter();

  const columns: DataColumn<CampaignTableRow>[] = [
    {
      key: "campaign",
      label: "Campaign",
      width: "min-w-[180px]",
      sortValue: (c) => c.name,
      render: (c) => (
        <div>
          <span className="text-[14px] font-semibold text-ink">{c.name}</span>
          <div className="text-[11px] text-ink-subtle mono-num uppercase">{c.source}</div>
        </div>
      ),
    },
    {
      key: "channel",
      label: "Channel",
      sortValue: (c) => (c.channel ? CHANNEL_META[c.channel]?.label ?? c.channel : null),
      filter: { value: (c) => c.channel, labelFor: (v) => CHANNEL_META[v]?.label ?? v },
      render: (c) => {
        const chan = c.channel ? CHANNEL_META[c.channel] : undefined;
        return chan ? (
          <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-semibold border border-rule bg-surface-alt ${chan.tone}`}>{chan.label}</span>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        );
      },
    },
    {
      key: "segment",
      label: "Segment",
      sortValue: (c) => (c.segment ? SEGMENT_META[c.segment]?.label ?? c.segment : null),
      filter: { value: (c) => c.segment, labelFor: (v) => SEGMENT_META[v]?.label ?? v },
      render: (c) => {
        const seg = c.segment ? SEGMENT_META[c.segment] : undefined;
        return seg ? (
          <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt ${seg.tone}`}>{seg.label}</span>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        );
      },
    },
    {
      key: "country",
      label: "Country",
      sortValue: (c) => c.country_code,
      filter: { value: (c) => c.country_code, labelFor: (v) => v.toUpperCase() },
      render: (c) => <span className="mono-num text-[13px] text-ink-muted uppercase">{c.country_code ?? "—"}</span>,
    },
    { key: "category", label: "Category", sortValue: (c) => c.category, render: (c) => <span className="text-[13px] text-ink-muted capitalize">{c.category ?? "—"}</span> },
    { key: "leads", label: "Leads", align: "right", sortValue: (c) => c.total, render: (c) => <span className="mono-num text-[13px] text-ink">{c.total}</span> },
    { key: "contacted", label: "Contacted", align: "right", sortValue: (c) => c.contacted, render: (c) => <span className="mono-num text-[13px] text-ink-muted">{c.contacted}</span> },
    { key: "interested", label: "Interested", align: "right", sortValue: (c) => c.interested, render: (c) => <span className="mono-num text-[13px] text-positive font-semibold">{c.interested}</span> },
    {
      key: "success",
      label: "Success",
      align: "right",
      sortValue: (c) => (c.contacted > 0 ? c.interested / c.contacted : null),
      render: (c) => <span className="mono-num text-[13px] text-ink">{successRate(c)}</span>,
    },
    {
      key: "status",
      label: "Status",
      sortValue: (c) => c.status,
      filter: { value: (c) => c.status, labelFor: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
      render: (c) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize ${STATUS_TONE[c.status] ?? "text-ink-muted"}`}>{c.status}</span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (c) => <CampaignRowActions id={c.id} name={c.name} status={c.status} channel={c.channel} />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(c) => c.id}
      storageKey="campaigns.columnOrder.v1"
      onRowClick={(c) => router.push(`/campaigns/${c.id}`)}
      minWidth="min-w-[900px]"
      empty="No campaigns yet."
      noun="campaigns"
      search={{
        placeholder: "Search campaigns…",
        text: (c) => [c.name, c.source, c.category, c.country_code, c.channel, c.segment, c.status].filter(Boolean).join(" "),
      }}
    />
  );
}
