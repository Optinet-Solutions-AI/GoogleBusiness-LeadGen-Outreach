"use client";

/**
 * LeadsTable.tsx — Leads table with row selection + "Add to campaign" bulk action.
 *
 * Inputs:  one page of leads (from the server Leads page), activeStage (current
 *          filter), totalCount (all matching rows), sort/page/per (URL state).
 * Outputs: select leads → AddToCampaignDialog; sort + paging push URL params.
 * Used by: app/(dashboard)/leads/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ExternalLink, Mail, PhoneCall, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { relativeTime } from "@/lib/format";
import { googleProfileUrl } from "@/lib/google";
import { countryLabel } from "@/lib/data/cities";
import { AddToCampaignDialog } from "@/components/AddToCampaignDialog";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { useServerTable } from "@/components/ui/useServerTable";
import type { SortState } from "@/lib/table";
import { signalSummary, type SignalFields } from "@/lib/lead-signal";
import { contactReadiness } from "@/lib/leads/contact-readiness";
import { cx } from "@/lib/cx";
import { EmailPreviewModal } from "@/components/outreach/EmailPreviewModal";
import { SimpleEmailModal } from "@/components/outreach/SimpleEmailModal";
import { CallPreviewModal } from "@/components/outreach/CallPreviewModal";

export interface LeadRow extends SignalFields {
  id: string;
  business_name: string;
  city: string | null;
  country_code: string | null;
  category: string | null;
  email: string | null;
  stage: string;
  demo_url: string | null;
  custom_domain: string | null;
  updated_at: string;
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
  verification_status: string | null;
  call_segment: string | null;
  place_id: string | null;
  seq_status: string | null;
  seq_step: number | null;
  screenshot_url: string | null;
  phone: string | null;
  contact_owner_name: string | null;
  contact_owner_role: string | null;
  lifecycle_stage: string | null;
  call_status: string | null;
}

export function LeadsTable({
  leads,
  activeStage,
  emailFilter,
  verifyFilter,
  totalCount,
  searchTerm,
  sort,
  page,
  per,
}: {
  leads: LeadRow[];
  activeStage: string | null;
  emailFilter?: "has" | "missing" | null;
  verifyFilter?: "verified" | "unverified" | "invalid" | null;
  totalCount: number;
  searchTerm?: string | null;
  sort: SortState | null;
  page: number;
  per: number;
}) {
  const router = useRouter();
  const server = useServerTable({ sort, page, per, total: totalCount, pageSizes: [25, 50, 100, 200], noun: "leads" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [building, setBuilding] = useState(false);

  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    const params = new URLSearchParams();
    if (activeStage) params.set("stage", activeStage);
    if (emailFilter) params.set("email", emailFilter);
    if (verifyFilter) params.set("verify", verifyFilter);
    if (searchTerm) params.set("q", searchTerm);
    const res = await fetchJson<{ ids: string[] }>(`/api/leads/ids?${params.toString()}`);
    setSelectingAll(false);
    if (res.success) setSelected(new Set(res.data.ids));
  }

  async function buildSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (ids.length > 200) {
      toast.warning("Build up to 200 at a time. Narrow the selection.");
      return;
    }
    if (!confirm(`Build demo sites for ${ids.length} lead${ids.length === 1 ? "" : "s"}? Non-buildable niches are skipped automatically. This uses AI copy + a deploy per site.`)) return;
    setBuilding(true);
    const res = await fetchJson<{ queued: number }>("/api/leads/build-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: ids }),
    });
    setBuilding(false);
    if (!res.success) {
      toast.error(res.error, { title: "Build failed to start" });
      return;
    }
    toast.success(`Building ${res.data.queued} demo${res.data.queued === 1 ? "" : "s"} — they'll fill in as each finishes.`);
    setSelected(new Set());
    router.refresh();
  }

  // One-lead actions (also run row by row over a selection). Each returns true on success.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ what: "find"; done: number; total: number } | null>(null);
  // Send email / Call with AI always open a preview first (one lead from a row, or the selection).
  const [preview, setPreview] = useState<null | { kind: "email" | "call"; ids: string[] }>(null);
  function openPreview(kind: "email" | "call", ids: string[]) {
    const cap = kind === "email" ? 50 : 25;
    if (ids.length > cap) {
      toast.warning(`Up to ${cap} at a time, so you can check each one. Narrow the selection.`);
      return;
    }
    setPreview({ kind, ids });
  }
  async function findOne(id: string, quiet = false): Promise<boolean> {
    const res = await fetchJson<{ message: string }>(`/api/leads/${id}/contacts`, { method: "POST" });
    if (!quiet) {
      if (!res.success) toast.error(res.error, { title: "Contact research" });
      else toast.success(res.data.message, { title: "Contact research" });
    }
    return res.success;
  }
  async function rowAction(id: string, fn: (id: string) => Promise<boolean>) {
    if (rowBusy) return;
    setRowBusy(id);
    try {
      await fn(id);
      router.refresh();
    } finally {
      setRowBusy(null);
    }
  }
  /** Run one action over the selection, one lead at a time, with a progress chip. */
  async function bulkAction(
    what: "find",
    fn: (id: string, quiet: boolean) => Promise<boolean>,
    cap: number,
    confirmText: string,
  ) {
    const ids = [...selected];
    if (!ids.length || bulk) return;
    if (ids.length > cap) {
      toast.warning(`Up to ${cap} at a time for this. Narrow the selection.`);
      return;
    }
    if (!confirm(confirmText)) return;
    setBulk({ what, done: 0, total: ids.length });
    let okCount = 0;
    for (const id of ids) {
      if (await fn(id, true)) okCount += 1;
      setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBulk(null);
    const noun = "researched";
    (okCount === ids.length ? toast.success : toast.warning)(
      `${okCount} of ${ids.length} ${noun}.${okCount < ids.length ? " Open a skipped lead to see why." : ""}`,
    );
    setSelected(new Set());
    router.refresh();
  }

  const columns: DataColumn<LeadRow>[] = [
    {
      key: "business_city",
      label: "Business / city",
      width: "min-w-[220px]",
      sortable: true,
      render: (lead) => (
        <>
          {googleProfileUrl(lead) ? (
            <a
              href={googleProfileUrl(lead)!}
              target="_blank"
              rel="noreferrer"
              title="View on Google Business Profile"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 max-w-full text-[14px] font-semibold text-ink hover:text-action hover:underline"
            >
              <span className="truncate">{lead.business_name}</span>
              <ExternalLink className="h-3 w-3 flex-none opacity-60" aria-hidden />
            </a>
          ) : (
            <div className="text-[14px] font-semibold text-ink truncate">{lead.business_name}</div>
          )}
          <div className="text-[11px] text-ink-subtle">
            {[lead.city, countryLabel(lead.country_code)].filter(Boolean).join(" · ") || lead.category || "—"}
          </div>
          <div className="mt-1">
            <LeadBadges lead={lead} />
          </div>
        </>
      ),
    },
    { key: "stage", label: "Stage", sortable: true, render: (lead) => <StageChip stage={lead.stage} /> },
    ...(leads.some((l) => !!l.signal_type)
      ? [
          {
            key: "signal",
            label: "Signal",
            width: "min-w-[200px]",
            render: (lead: LeadRow) =>
              lead.signal_type ? (
                <span className="text-[12px] text-ink-muted">{signalSummary(lead)}</span>
              ) : (
                <span className="text-ink-subtle text-[13px]">—</span>
              ),
          } satisfies DataColumn<LeadRow>,
        ]
      : []),
    {
      key: "email",
      label: "Contact",
      width: "min-w-[240px]",
      sortable: true,
      render: (lead) => {
        const r = contactReadiness(lead);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="mono-num text-[13px] text-ink truncate">{lead.email ?? <span className="text-ink-subtle">no email</span>}</span>
              <span className={cx("flex-none px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none", r.email.tone === "positive" ? "bg-positive-soft text-positive" : r.email.tone === "warning" ? "bg-warning-soft text-warning" : r.email.tone === "urgent" ? "bg-urgent-soft text-urgent" : "bg-surface-alt text-ink-subtle")} title={r.email.hint}>
                {r.email.label}
              </span>
            </div>
            <div className="mono-num text-[12px] text-ink-muted">{lead.phone ?? <span className="text-ink-subtle">no phone</span>}</div>
            {lead.contact_owner_name && (
              <div className="flex items-center gap-1 text-[11px] text-ink-muted truncate">
                <User className="h-3 w-3 flex-none" strokeWidth={1.75} aria-hidden />
                {lead.contact_owner_name}
                {lead.contact_owner_role ? ` \u00b7 ${lead.contact_owner_role}` : ""}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      label: "Reach out",
      width: "w-[120px]",
      render: (lead) => {
        const r = contactReadiness(lead);
        const closed = ["closed_won", "closed_lost", "dead", "handed_over"].includes(lead.stage);
        if (closed) return <span className="text-ink-subtle text-[12px]">&mdash;</span>;
        const busy = rowBusy === lead.id;
        const canEmail = r.canEmail;
        const btn = "p-1.5 rounded border border-rule bg-surface text-ink hover:bg-surface-alt disabled:opacity-35";
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!canEmail || !!rowBusy}
              onClick={() => openPreview("email", [lead.id])}
              title={canEmail ? "Send email (pick the service, check the email first)" : r.email.hint}
              className={btn}
              aria-label="Send email"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              disabled={(!!r.callBlock && !!lead.phone) || !!rowBusy}
              onClick={() => openPreview("call", [lead.id])}
              title={lead.phone ? r.callBlock ?? "Call with AI" : "No phone on file: type a number in the call window (e.g. yours, to test)"}
              className={btn}
              aria-label="Call with AI"
            >
              <PhoneCall className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              disabled={!!rowBusy}
              onClick={() => rowAction(lead.id, findOne)}
              title="Find contacts (AI): email, phone, owner. About 3 cents."
              className={cx(btn, busy && "animate-pulse")}
              aria-label="Find contacts with AI"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        );
      },
    },
    {
      key: "live_url",
      label: "Live URL",
      render: (lead) =>
        lead.custom_domain ? (
          <a href={`https://${lead.custom_domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mono-num text-[13px] text-positive hover:underline truncate block max-w-[220px]">
            {lead.custom_domain}
          </a>
        ) : lead.demo_url ? (
          <a href={lead.demo_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mono-num text-[13px] text-action hover:underline truncate block max-w-[220px]">
            {lead.demo_url.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span className="text-ink-subtle text-[13px]">—</span>
        ),
    },
    {
      key: "updated",
      label: "Updated",
      sortable: true,
      render: (lead) => <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(lead.updated_at)}</span>,
    },
    {
      key: "open",
      label: "",
      align: "right",
      width: "w-10",
      render: (lead) => (
        <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="text-ink-subtle hover:text-ink inline-block">
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Action bar */}
      {selected.size > 0 && (
        <div className="bg-surface border border-rule rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 sticky top-2 z-10">
          <div className="text-[13px] text-ink">
            <span className="mono-num font-semibold">{selected.size}</span> selected
            {selected.size < totalCount && (
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={selectingAll}
                className="ml-3 text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
              >
                {selectingAll ? "Selecting…" : `Select all ${totalCount}`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {bulk && (
              <span className="text-[12px] text-ink-muted mono-num">
                Researching {bulk.done}/{bulk.total}&hellip;
              </span>
            )}
            <Button
              size="sm"
              variant="soft"
              disabled={!!bulk}
              onClick={() =>
                bulkAction("find", findOne, 25, `Find contacts (email, phone, owner) with AI for ${selected.size} lead${selected.size === 1 ? "" : "s"}? About 3 cents each, 10-40 seconds per lead.`)
              }
            >
              <Sparkles strokeWidth={2} /> Find contacts (AI)
            </Button>
            <Button
              size="sm"
              variant="soft"
              disabled={!!bulk}
              onClick={() => openPreview("email", [...selected])}
            >
              <Mail strokeWidth={2} /> Email selected
            </Button>
            <Button
              size="sm"
              variant="soft"
              disabled={!!bulk}
              onClick={() => openPreview("call", [...selected])}
            >
              <PhoneCall strokeWidth={2} /> Call selected
            </Button>
            <Button size="sm" variant="secondary" onClick={buildSelected} loading={building} disabled={!!bulk}>Build demos</Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!!bulk}>Add to campaign</Button>
            <button onClick={() => setSelected(new Set())} className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink bg-transparent border-0 p-0 cursor-pointer">Clear</button>
          </div>
        </div>
      )}

      <DataTable
        rows={leads}
        columns={columns}
        getRowId={(l) => l.id}
        storageKey="leads.columnOrder.v1"
        onRowClick={(l) => router.push(`/leads/${l.id}`)}
        rowClassName={(l) => (selected.has(l.id) ? "bg-action-soft/40" : "")}
        selection={{ selected, onToggle: toggle, onToggleAll: toggleAll, allSelected }}
        empty="No leads match these filters."
        server={server}
      />

      {/* One lead (row button): the Send email window. Several (bulk): the classic sequence preview. */}
      {preview?.kind === "email" && preview.ids.length === 1 && (
        <SimpleEmailModal leadId={preview.ids[0]} onClose={() => setPreview(null)} onDone={() => router.refresh()} />
      )}
      {preview?.kind === "email" && preview.ids.length > 1 && (
        <EmailPreviewModal
          leadIds={preview.ids}
          onClose={() => setPreview(null)}
          onDone={() => { if (preview.ids.length > 1) setSelected(new Set()); router.refresh(); }}
        />
      )}
      {preview?.kind === "call" && (
        <CallPreviewModal
          leadIds={preview.ids}
          onClose={() => setPreview(null)}
          onDone={() => { if (preview.ids.length > 1) setSelected(new Set()); router.refresh(); }}
        />
      )}

      {dialogOpen && (
        <AddToCampaignDialog
          leadIds={[...selected]}
          onClose={() => setDialogOpen(false)}
          onDone={() => { setDialogOpen(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
