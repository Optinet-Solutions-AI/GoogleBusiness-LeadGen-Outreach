"use client";

/**
 * RevenueTable.tsx — every billed lead: search, status filter, sortable
 * setup / monthly / status / updated columns, paging.
 *
 * Inputs:  billed lead rows (already ordered active-first, then by monthly).
 * Outputs: customer name links to the lead page.
 * Used by: app/(dashboard)/revenue/page.tsx
 */

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { relativeTime, usd } from "@/lib/format";

export interface BilledLead {
  id: string;
  business_name: string;
  custom_domain: string | null;
  setup_fee: number | null;
  monthly_amount: number | null;
  billing_status: string | null;
  billing_updated_at: string | null;
}

const STATUS_META: Record<string, { label: string; cls: string; order: number }> = {
  active: { label: "Active", cls: "bg-positive-soft text-positive border-positive/30", order: 0 },
  invoiced: { label: "Invoiced", cls: "bg-action-soft text-action border-action/30", order: 1 },
  past_due: { label: "Past due", cls: "bg-warning-soft text-warning border-warning/30", order: 2 },
  canceled: { label: "Canceled", cls: "bg-surface-alt text-ink-subtle border-rule", order: 3 },
};

const num = (v: number | null) => (v == null ? null : Number(v));

export function RevenueTable({ rows }: { rows: BilledLead[] }) {
  const columns: DataColumn<BilledLead>[] = [
    {
      key: "customer",
      label: "Customer",
      sortValue: (l) => l.business_name,
      render: (l) => (
        <>
          <Link href={`/leads/${l.id}`} className="text-[14px] font-semibold text-ink hover:text-action">
            {l.business_name}
          </Link>
          {l.custom_domain && <div className="text-[11px] text-ink-subtle mono-num">{l.custom_domain}</div>}
        </>
      ),
    },
    {
      key: "setup",
      label: "Setup",
      align: "right",
      sortValue: (l) => num(l.setup_fee),
      render: (l) => (
        <span className="mono-num text-[13px] text-ink-muted">{l.setup_fee != null ? usd(l.setup_fee, 0) : "—"}</span>
      ),
    },
    {
      key: "monthly",
      label: "Monthly",
      align: "right",
      sortValue: (l) => num(l.monthly_amount),
      render: (l) => (
        <span className="mono-num text-[13px] text-ink">{l.monthly_amount != null ? `${usd(l.monthly_amount, 0)}/mo` : "—"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortValue: (l) => STATUS_META[l.billing_status ?? ""]?.order ?? 9,
      filter: { value: (l) => l.billing_status, labelFor: (v) => STATUS_META[v]?.label ?? v },
      render: (l) => {
        const meta = STATUS_META[l.billing_status ?? ""] ?? {
          label: l.billing_status ?? "—",
          cls: "bg-surface-alt text-ink-muted border-rule",
        };
        return <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-semibold border ${meta.cls}`}>{meta.label}</span>;
      },
    },
    {
      key: "updated",
      label: "Updated",
      sortValue: (l) => l.billing_updated_at,
      render: (l) => <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(l.billing_updated_at)}</span>,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(l) => l.id}
      storageKey="revenue.columnOrder.v1"
      minWidth="min-w-[640px]"
      maxHeight="max-h-[calc(100vh-22rem)]"
      noun="customers"
      search={{
        placeholder: "Search customer or domain…",
        text: (l) => [l.business_name, l.custom_domain].filter(Boolean).join(" "),
      }}
    />
  );
}
