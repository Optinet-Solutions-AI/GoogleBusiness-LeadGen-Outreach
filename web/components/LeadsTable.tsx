"use client";

/**
 * LeadsTable.tsx — Leads table with row selection + "Add to campaign" bulk action.
 *
 * Inputs:  leads (from the server Leads page), activeStage (current filter), totalCount
 * Outputs: select leads → AddToCampaignDialog
 * Used by: app/(dashboard)/leads/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { relativeTime } from "@/lib/format";
import { googleProfileUrl } from "@/lib/google";
import { countryLabel } from "@/lib/data/cities";
import { AddToCampaignDialog } from "@/components/AddToCampaignDialog";
import { fetchJson } from "@/lib/fetch-json";

export interface LeadRow {
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
}

export function LeadsTable({
  leads,
  activeStage,
  emailFilter,
  verifyFilter,
  totalCount,
  searchTerm,
}: {
  leads: LeadRow[];
  activeStage: string | null;
  emailFilter?: "has" | "missing" | null;
  verifyFilter?: "verified" | "unverified" | "invalid" | null;
  totalCount: number;
  searchTerm?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

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
          <div className="flex items-center gap-3 shrink-0">
            <Button size="sm" onClick={() => setDialogOpen(true)}>Add to campaign</Button>
            <button onClick={() => setSelected(new Set())} className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink bg-transparent border-0 p-0 cursor-pointer">Clear</button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
        <table className="w-full min-w-[680px] text-left">
          <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
            <tr>
              <th className="px-3 py-3 w-9">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="cursor-pointer" />
              </th>
              <Th>Business / city</Th>
              <Th>Stage</Th>
              <Th>Email</Th>
              <Th>Live URL</Th>
              <Th>Updated</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => router.push(`/leads/${lead.id}`)}
                className={`hover:bg-surface-alt transition-colors group cursor-pointer ${selected.has(lead.id) ? "bg-action-soft/40" : ""}`}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${lead.business_name}`}
                    className="cursor-pointer"
                  />
                </td>
                <td className="px-4 py-2.5">
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
                </td>
                <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                <td className="px-4 py-2.5 max-w-[200px]">
                  <div className="mono-num text-[13px] text-ink-muted truncate">
                    {lead.email ?? <span className="text-ink-subtle">—</span>}
                  </div>
                  {lead.verification_status && (
                    <VerifyChip status={lead.verification_status} />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {lead.custom_domain ? (
                    <a href={`https://${lead.custom_domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mono-num text-[13px] text-positive hover:underline truncate block max-w-[220px]">
                      {lead.custom_domain}
                    </a>
                  ) : lead.demo_url ? (
                    <a href={lead.demo_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mono-num text-[13px] text-action hover:underline truncate block max-w-[220px]">
                      {lead.demo_url.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-ink-subtle text-[13px]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">{relativeTime(lead.updated_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="text-ink-subtle hover:text-ink group-hover:translate-x-0.5 transition-all inline-block">
                    <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

function VerifyChip({ status }: { status: string }) {
  if (status === "valid") {
    return (
      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-positive-soft text-positive">
        valid
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-urgent/10 text-urgent">
        invalid
      </span>
    );
  }
  if (status === "catch-all") {
    return (
      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-warning/10 text-warning">
        catch-all
      </span>
    );
  }
  // unknown or any unexpected value
  return (
    <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-surface-alt text-ink-subtle">
      {status}
    </span>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>{children}</th>;
}
