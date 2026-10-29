"use client";

/**
 * BatchLeadsTables.tsx — the two lead tables on a batch's detail page.
 *
 * Inputs:  qualified + rejected lead rows for one batch (from the server page).
 * Outputs: <BatchLeadsTable> (search, stage/email/demo/error filters, sort, paging,
 *          row → lead page) and <RejectedLeadsTable> (search, reason/category/
 *          website filters, sort, paging).
 * Used by: app/(dashboard)/batches/[id]/page.tsx
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip, stageLabel, stageOrder } from "@/components/StageChip";
import { googleProfileUrl } from "@/lib/google";
import { REJECTION_REASON_LABEL } from "@/lib/filters";
import { SIGNAL_FILTER_OPTIONS, signalSummary, type SignalFields } from "@/lib/lead-signal";

export interface BatchLead extends SignalFields {
  id: string;
  business_name: string;
  address: string | null;
  stage: string;
  email: string | null;
  demo_url: string | null;
  last_error: string | null;
  created_at: string;
  qualified: boolean | null;
  rejection_reason: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean | null;
  phone: string | null;
  website_url: string | null;
  website_kind: WebsiteKind | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  language_code: string | null;
  primary_offer: "build_website" | "improve_website" | "voice_agent" | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  call_segment: string | null;
  place_id: string | null;
}

const HAS_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const stop = (e: React.MouseEvent) => e.stopPropagation();

export function BatchLeadsTable({ leads }: { leads: BatchLead[] }) {
  const router = useRouter();
  const hasSignal = leads.some((l) => !!l.signal_type);
  const signalColumn: DataColumn<BatchLead> = {
    key: "signal",
    label: "Signal",
    width: "min-w-[200px]",
    sortValue: (l) => l.signal_date ?? "",
    filter: { label: "Signal", value: (l) => l.signal_type ?? "", options: SIGNAL_FILTER_OPTIONS },
    render: (lead) =>
      lead.signal_type ? (
        <span className="text-[12px] text-ink-muted">{signalSummary(lead)}</span>
      ) : (
        <span className="text-ink-subtle text-[13px]">—</span>
      ),
  };
  const columns: DataColumn<BatchLead>[] = [
    {
      key: "business",
      label: "Business / city",
      width: "min-w-[220px]",
      sortValue: (l) => l.business_name,
      render: (lead) => (
        <>
          {googleProfileUrl(lead) ? (
            <a
              href={googleProfileUrl(lead)!}
              target="_blank"
              rel="noreferrer"
              title="View on Google Business Profile"
              onClick={stop}
              className="inline-flex items-center gap-1 text-[14px] font-semibold text-ink hover:text-action hover:underline"
            >
              {lead.business_name}
              <ExternalLink className="h-3 w-3 flex-none opacity-60" aria-hidden />
            </a>
          ) : (
            <div className="text-[14px] font-semibold text-ink">{lead.business_name}</div>
          )}
          <div className="text-[11px] text-ink-subtle">{lead.address ?? "—"}</div>
          <div className="mt-1">
            <LeadBadges lead={lead} />
          </div>
        </>
      ),
    },
    {
      key: "stage",
      label: "Stage",
      sortValue: (l) => stageOrder(l.stage),
      filter: { value: (l) => l.stage, labelFor: stageLabel },
      render: (lead) => <StageChip stage={lead.stage} />,
    },
    ...(hasSignal ? [signalColumn] : []),
    {
      key: "email",
      label: "Email",
      sortValue: (l) => l.email,
      filter: { label: "Has email", value: (l) => (l.email ? "yes" : "no"), options: HAS_NO },
      render: (lead) => (
        <span className="mono-num text-[13px] text-ink-muted">
          {lead.email ?? <span className="text-ink-subtle">needs email</span>}
        </span>
      ),
    },
    {
      key: "demo",
      label: "Demo URL",
      sortValue: (l) => l.demo_url,
      filter: { label: "Has demo", value: (l) => (l.demo_url ? "yes" : "no"), options: HAS_NO },
      render: (lead) =>
        lead.demo_url ? (
          <a
            href={lead.demo_url}
            target="_blank"
            rel="noreferrer"
            onClick={stop}
            className="mono-num text-[13px] text-action hover:underline truncate block max-w-[200px]"
          >
            {lead.demo_url.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        ),
    },
    {
      key: "error",
      label: "Last error",
      sortValue: (l) => l.last_error,
      filter: { label: "Has error", value: (l) => (l.last_error ? "yes" : "no"), options: HAS_NO },
      render: (lead) =>
        lead.last_error ? (
          <span className="text-[12px] text-urgent line-clamp-1 max-w-[260px] block">{lead.last_error}</span>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        ),
    },
    {
      key: "open",
      label: "",
      align: "right",
      width: "w-10",
      render: (lead) => (
        <Link href={`/leads/${lead.id}`} title="Open lead" onClick={stop} className="text-ink-subtle hover:text-ink transition-colors inline-block">
          <ChevronRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      rows={leads}
      columns={columns}
      getRowId={(l) => l.id}
      storageKey="batch-leads.columnOrder.v1"
      onRowClick={(l) => router.push(`/leads/${l.id}`)}
      noun="leads"
      empty="No leads scraped yet."
      search={{
        placeholder: "Search leads…",
        text: (l) => [l.business_name, l.address, l.email, l.category, l.phone].filter(Boolean).join(" "),
      }}
    />
  );
}

function parseReason(raw: string | null): { key: string; detail: string | null } {
  if (!raw) return { key: "unknown", detail: null };
  const idx = raw.indexOf(":");
  if (idx < 0) return { key: raw, detail: null };
  return { key: raw.slice(0, idx).trim(), detail: raw.slice(idx + 1).trim() };
}

const reasonLabel = (key: string) => REJECTION_REASON_LABEL[key] ?? key;

export function RejectedLeadsTable({ leads }: { leads: BatchLead[] }) {
  const columns: DataColumn<BatchLead>[] = [
    {
      key: "business",
      label: "Business",
      sortValue: (l) => l.business_name,
      render: (lead) => (
        <>
          <div className="text-[13px] font-medium text-ink">{lead.business_name}</div>
          <div className="text-[11px] text-ink-subtle">{lead.address ?? "—"}</div>
        </>
      ),
    },
    {
      key: "reason",
      label: "Why rejected",
      sortValue: (l) => reasonLabel(parseReason(l.rejection_reason).key),
      filter: { label: "Reason", value: (l) => parseReason(l.rejection_reason).key, labelFor: reasonLabel },
      render: (lead) => {
        const { key, detail } = parseReason(lead.rejection_reason);
        return (
          <>
            <div className="text-[12px] font-medium text-warning">{reasonLabel(key)}</div>
            {detail && <div className="text-[11px] text-ink-subtle font-mono">{detail}</div>}
          </>
        );
      },
    },
    {
      key: "category",
      label: "Category",
      sortValue: (l) => l.category,
      filter: { value: (l) => l.category },
      render: (lead) => <span className="mono-num text-[12px] text-ink-muted">{lead.category ?? "—"}</span>,
    },
    {
      key: "rating",
      label: "Rating",
      sortValue: (l) => l.rating,
      render: (lead) => (
        <span className="mono-num text-[12px] text-ink-muted">{lead.rating != null ? `${lead.rating.toFixed(1)}★` : "—"}</span>
      ),
    },
    {
      key: "reviews",
      label: "Reviews",
      sortValue: (l) => l.review_count ?? 0,
      render: (lead) => <span className="mono-num text-[12px] text-ink-muted">{lead.review_count ?? 0}</span>,
    },
    {
      key: "website",
      label: "Website",
      sortValue: (l) => !!l.has_website,
      filter: { value: (l) => (l.has_website ? "yes" : "no"), options: HAS_NO },
      render: (lead) =>
        lead.has_website ? (
          <span className="text-[12px] text-urgent font-semibold">Yes</span>
        ) : (
          <span className="text-[12px] text-positive">No</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={leads}
      columns={columns}
      getRowId={(l) => l.id}
      storageKey="batch-rejected.columnOrder.v1"
      noun="rejected leads"
      search={{
        placeholder: "Search rejected leads…",
        text: (l) => [l.business_name, l.address, l.category, l.rejection_reason].filter(Boolean).join(" "),
      }}
    />
  );
}
