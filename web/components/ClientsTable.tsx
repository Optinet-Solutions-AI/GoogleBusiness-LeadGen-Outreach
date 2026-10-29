"use client";

/**
 * ClientsTable.tsx — clients list: search, status filter, sortable/draggable columns.
 *
 * Inputs:  rows (ClientListRow[], serializable) from the server clients page.
 * Outputs: a DataTable; row click navigates to /clients/<id>.
 * Used by: app/(dashboard)/clients/page.tsx
 */

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { relativeTime } from "@/lib/format";
import { cx } from "@/lib/cx";
import type { ClientListRow } from "@/lib/clients/clients";

const STATUS_TONE: Record<string, string> = {
  pilot: "text-ink",
  active: "text-positive",
  paused: "text-warning",
  churned: "text-ink-muted",
};

const SOURCE_LABEL: Record<string, string> = {
  website: "web",
  demo_site: "demo",
  facebook: "FB",
  instagram: "IG",
  google_maps: "Maps",
  operator: "intake",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize",
        STATUS_TONE[status] ?? "text-ink-muted",
      )}
    >
      {status}
    </span>
  );
}

export function ClientsTable({ rows }: { rows: ClientListRow[] }) {
  const router = useRouter();

  const columns: DataColumn<ClientListRow>[] = [
    {
      key: "name",
      label: "Client",
      width: "min-w-[200px]",
      sortValue: (c) => c.name,
      render: (c) => <span className="text-[14px] font-semibold text-ink">{c.name}</span>,
    },
    {
      key: "status",
      label: "Status",
      sortValue: (c) => c.status,
      filter: { value: (c) => c.status, labelFor: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
      render: (c) => <StatusChip status={c.status} />,
    },
    {
      key: "sources",
      label: "Sources",
      sortValue: (c) => c.source_kinds.length,
      render: (c) =>
        c.source_kinds.length === 0 ? (
          <span className="text-ink-subtle text-[13px]">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {c.source_kinds.map((k) => (
              <span key={k} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border border-rule bg-surface-alt text-ink-muted">
                {SOURCE_LABEL[k] ?? k}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "version",
      label: "Version",
      align: "right",
      sortValue: (c) => c.current_version,
      render: (c) => <span className="mono-num text-[13px] text-ink">{c.current_version > 0 ? `v${c.current_version}` : "—"}</span>,
    },
    {
      key: "last_built",
      label: "Last built",
      sortValue: (c) => c.last_job_at,
      render: (c) => <span className="text-[13px] text-ink-muted">{c.last_job_at ? relativeTime(c.last_job_at) : "—"}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      align: "right",
      sortValue: (c) => c.cost_usd,
      render: (c) => <span className="mono-num text-[13px] text-ink-muted">{`$${c.cost_usd.toFixed(2)}`}</span>,
    },
    {
      key: "open",
      label: "",
      align: "right",
      render: () => <ChevronRight className="h-4 w-4 text-ink-subtle inline-block" aria-hidden />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(c) => c.id}
      storageKey="clients.columnOrder.v1"
      onRowClick={(c) => router.push(`/clients/${c.id}`)}
      minWidth="min-w-[760px]"
      empty="No clients yet."
      noun="clients"
      search={{ placeholder: "Search clients…", text: (c) => c.name }}
    />
  );
}
