"use client";

/**
 * BatchesTable.tsx — interactive batches table.
 *
 * - Sticky header that stays visible while the body scrolls (header + body
 *   share one scroll container, so vertical AND horizontal scroll work).
 * - Drag a column header to reorder columns (like Google Sheets); the order
 *   persists per browser in localStorage.
 *
 * Inputs:  rows (precomputed, serializable) from the server page.
 * Used by: app/(dashboard)/batches/page.tsx
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, GripVertical } from "lucide-react";
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

interface Col {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: string;
  render: (b: BatchRow) => React.ReactNode;
}

const COLUMNS: Col[] = [
  {
    key: "niche_city",
    label: "Niche / City",
    width: "min-w-[180px]",
    render: (b) => (
      <div>
        <div className="text-[14px] text-ink font-semibold capitalize">{b.niche}</div>
        <div className="text-[12px] text-ink-subtle">{b.city}</div>
      </div>
    ),
  },
  { key: "scraper", label: "Scraper", render: (b) => <ScraperBadge scraper={b.scraper} /> },
  { key: "status", label: "Status", render: (b) => <StatusChip status={b.status} /> },
  {
    key: "scraped_qualified",
    label: "Scraped → qualified",
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
    align: "right",
    render: (b) => <span className="mono-num text-[13px] text-ink-muted">{usd(b.estimated_cost_usd)}</span>,
  },
  {
    key: "created",
    label: "Created",
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

const STORAGE_KEY = "batches.columnOrder.v1";

/** Reconcile a saved order with the current column set (drop removed, append new). */
function reconcile(saved: string[]): string[] {
  const known = COLUMNS.map((c) => c.key);
  const kept = saved.filter((k) => known.includes(k));
  const missing = known.filter((k) => !kept.includes(k));
  return [...kept, ...missing];
}

export function BatchesTable({ rows }: { rows: BatchRow[] }) {
  const router = useRouter();
  const [order, setOrder] = useState<string[]>(COLUMNS.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Load persisted order once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOrder(reconcile(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  function persist(next: string[]) {
    setOrder(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function onDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    const next = [...order];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(targetKey);
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    persist(next);
    setDragKey(null);
    setOverKey(null);
  }

  const cols = order.map((k) => COLUMNS.find((c) => c.key === k)!).filter(Boolean);

  return (
    <div className="bg-surface border border-rule rounded-lg overflow-auto max-h-[calc(100vh-13rem)]">
      <table className="w-full min-w-[860px] text-left border-collapse">
        <thead className="sticky top-0 z-20 bg-surface-alt">
          <tr className="border-b border-rule">
            {cols.map((c) => (
              <th
                key={c.key}
                draggable
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overKey !== c.key) setOverKey(c.key);
                }}
                onDrop={() => onDrop(c.key)}
                onDragEnd={() => {
                  setDragKey(null);
                  setOverKey(null);
                }}
                className={[
                  "group/th px-4 py-3 text-label-caps uppercase tracking-[0.18em] select-none cursor-grab active:cursor-grabbing whitespace-nowrap",
                  c.align === "right" ? "text-right" : "text-left",
                  c.width ?? "",
                  overKey === c.key && dragKey && dragKey !== c.key ? "bg-action-soft" : "",
                  dragKey === c.key ? "opacity-50" : "",
                  "text-ink-muted",
                ].join(" ")}
              >
                <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                  <GripVertical className="h-3 w-3 text-ink-subtle opacity-0 group-hover/th:opacity-100" strokeWidth={2} />
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                No batches yet. Click <span className="text-action font-semibold">+ New batch</span> above to get started.
              </td>
            </tr>
          )}
          {rows.map((b) => (
            <tr
              key={b.id}
              onClick={() => router.push(`/batches/${b.id}`)}
              className="hover:bg-surface-alt transition-colors cursor-pointer"
            >
              {cols.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""} ${c.width ?? ""}`}>
                  {c.render(b)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
