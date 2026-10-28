"use client";

/**
 * BatchesTable.tsx — interactive batches table.
 *
 * Renders the shared <DataTable> in server mode: sticky header, drag-to-reorder
 * columns, click-to-sort headers and a pagination footer. Sort + paging push
 * URL params; the server page does the actual query.
 *
 * Inputs:  one page of rows (precomputed, serializable) + sort/page/per/total.
 * Used by: app/(dashboard)/batches/page.tsx
 */

import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { useServerTable } from "@/components/ui/useServerTable";
import type { SortState } from "@/lib/table";
import { StatusChip } from "@/components/StatusChip";
import { ScraperBadge } from "@/components/ScraperBadge";
import { StageFunnelBar } from "@/components/StageFunnelBar";
import { relativeTime, usd } from "@/lib/format";

export interface BatchRow {
  id: string;
  niche: string;
  city: string;
  scraper: string;
  status: string;
  scraped_count: number | null;
  qualified: number;
  counts: Record<string, number>;
  total: number;
  replies: number;
  estimated_cost_usd: number | null;
  created_at: string;
}

const COLUMNS: DataColumn<BatchRow>[] = [
  {
    key: "niche_city",
    label: "Niche / City",
    sortable: true,
    width: "min-w-[180px]",
    render: (b) => (
      <div>
        <div className="text-[14px] text-ink font-semibold capitalize">{b.niche}</div>
        <div className="text-[12px] text-ink-subtle">{b.city}</div>
      </div>
    ),
  },
  { key: "scraper", label: "Scraper", sortable: true, render: (b) => <ScraperBadge scraper={b.scraper} /> },
  { key: "status", label: "Status", sortable: true, render: (b) => <StatusChip status={b.status} /> },
  {
    key: "scraped_qualified",
    label: "Scraped → qualified",
    sortable: true,
    render: (b) => <ScrapeRatio scraped={b.scraped_count} qualified={b.qualified} status={b.status} />,
  },
  {
    key: "stage_funnel",
    label: "Stage funnel",
    width: "w-44",
    render: (b) => <StageFunnelBar counts={b.counts} total={b.total} />,
  },
  {
    key: "replies",
    label: "Replies",
    render: (b) =>
      b.replies > 0 ? (
        <span className="bg-positive-soft text-positive px-2 py-0.5 rounded font-mono text-[11px] font-bold">{b.replies}</span>
      ) : (
        <span className="bg-surface-alt text-ink-subtle px-2 py-0.5 rounded font-mono text-[11px] font-bold">0</span>
      ),
  },
  {
    key: "est_cost",
    label: "Est. cost",
    sortable: true,
    align: "right",
    render: (b) => <span className="mono-num text-[13px] text-ink-muted">{usd(b.estimated_cost_usd)}</span>,
  },
  {
    key: "created",
    label: "Created",
    sortable: true,
    render: (b) => <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(b.created_at)}</span>,
  },
  {
    key: "csv",
    label: "CSV",
    align: "right",
    width: "w-16",
    render: (b) => (
      <a
        href={`/api/batches/${b.id}/export`}
        title="Export phone-reachable leads (CSV)"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex text-ink-subtle hover:text-action transition-colors"
      >
        <Download className="h-[18px] w-[18px]" />
      </a>
    ),
  },
];

export function BatchesTable({
  rows,
  sort,
  page,
  per,
  total,
}: {
  rows: BatchRow[];
  sort: SortState | null;
  page: number;
  per: number;
  total: number;
}) {
  const router = useRouter();
  const server = useServerTable({ sort, page, per, total, noun: "batches" });
  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      getRowId={(b) => b.id}
      storageKey="batches.columnOrder.v1"
      onRowClick={(b) => router.push(`/batches/${b.id}`)}
      minWidth="min-w-[860px]"
      server={server}
      empty={
        <>
          No batches yet. Click <span className="text-action font-semibold">+ New batch</span> above to get started.
        </>
      }
    />
  );
}

function ScrapeRatio({
  scraped,
  qualified,
  status,
}: {
  scraped: number | null;
  qualified: number;
  status: string;
}) {
  if (status === "queued" || status === "running") {
    return <span className="mono-num text-[12px] text-ink-subtle">—</span>;
  }
  if (scraped == null || scraped === 0) {
    return <span className="mono-num text-[12px] text-ink-subtle">no results</span>;
  }
  const allRejected = qualified === 0;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="mono-num text-[13px] font-semibold text-ink">{scraped}</span>
      <span className="text-ink-subtle text-[11px]">→</span>
      <span
        className={[
          "mono-num text-[13px] font-bold",
          allRejected ? "text-warning" : qualified > 0 ? "text-positive" : "text-ink-subtle",
        ].join(" ")}
      >
        {qualified}
      </span>
      {allRejected && (
        <span className="text-[10px] text-warning font-semibold ml-1 font-mono" title="All scraped leads had websites">
          (all had sites)
        </span>
      )}
    </div>
  );
}
