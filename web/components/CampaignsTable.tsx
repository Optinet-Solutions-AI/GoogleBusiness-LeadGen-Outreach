"use client";

/**
 * CampaignsTable.tsx — campaigns list with sticky header + draggable columns.
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
      render: (c) => {
        const seg = c.segment ? SEGMENT_META[c.segment] : undefined;
        return seg ? (
          <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt ${seg.tone}`}>{seg.label}</span>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        );
      },
    },
    { key: "country", label: "Country", render: (c) => <span className="mono-num text-[13px] text-ink-muted uppercase">{c.country_code ?? "—"}</span> },
    { key: "category", label: "Category", render: (c) => <span className="text-[13px] text-ink-muted capitalize">{c.category ?? "—"}</span> },
    { key: "leads", label: "Leads", align: "right", render: (c) => <span className="mono-num text-[13px] text-ink">{c.total}</span> },
    { key: "contacted", label: "Contacted", align: "right", render: (c) => <span className="mono-num text-[13px] text-ink-muted">{c.contacted}</span> },
    { key: "interested", label: "Interested", align: "right", render: (c) => <span className="mono-num text-[13px] text-positive font-semibold">{c.interested}</span> },
    { key: "success", label: "Success", align: "right", render: (c) => <span className="mono-num text-[13px] text-ink">{successRate(c)}</span> },
    {
      key: "status",
      label: "Status",
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
    />
  );
}
