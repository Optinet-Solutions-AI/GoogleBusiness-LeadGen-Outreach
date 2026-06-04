"use client";

/**
 * LeadsTable.tsx — Leads table with row selection + bulk "Send via best channel".
 *
 * Inputs:  leads (from the server Leads page)
 * Outputs: select leads → preview routing (dry-run) → confirm → POST /api/leads/send
 * Used by: app/(dashboard)/leads/page.tsx
 *
 * Routing is server-side (email if email, else SMS if phone, else skip); this just drives selection
 * + the confirm-with-preview. Sends are $0 soft-no-op until a mailbox/SMS key is connected.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";

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
}

interface Summary {
  total: number;
  emailed: number;
  texted: number;
  skipped_no_contact: number;
  skipped_already: number;
  skipped_suppressed: number;
  failed: number;
  dry_run: boolean;
}

type Phase = "idle" | "previewing" | "sending";

export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  function clear() {
    setSelected(new Set());
    setResult(null);
    setError(null);
  }

  async function call(dryRun: boolean): Promise<Summary | null> {
    const res = await fetch("/api/leads/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ leadIds: [...selected], dryRun }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error ?? "Request failed");
      return null;
    }
    return json.data as Summary;
  }

  async function openPreview() {
    setError(null);
    setResult(null);
    setPhase("previewing");
    const data = await call(true);
    setPhase("idle");
    if (data) setPreview(data);
  }

  async function confirmSend() {
    setPhase("sending");
    const data = await call(false);
    setPhase("idle");
    setPreview(null);
    if (data) {
      setResult(data);
      setSelected(new Set());
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {/* Action bar */}
      {(selected.size > 0 || result || error) && (
        <div className="bg-surface border border-rule rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 sticky top-2 z-10">
          <div className="text-[13px] text-ink">
            {error ? (
              <span className="text-urgent">{error}</span>
            ) : result ? (
              <span className="text-positive">
                Done — {result.emailed} emailed, {result.texted} texted
                {result.skipped_no_contact + result.skipped_already + result.skipped_suppressed > 0 &&
                  `, ${result.skipped_no_contact + result.skipped_already + result.skipped_suppressed} skipped`}
                {result.failed > 0 && `, ${result.failed} failed`}.
              </span>
            ) : (
              <span>
                <span className="mono-num font-semibold">{selected.size}</span> selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {selected.size > 0 && !result && (
              <button
                onClick={openPreview}
                disabled={phase !== "idle"}
                className="px-3.5 py-1.5 rounded bg-action text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {phase === "previewing" ? "Checking…" : "Send via best channel"}
              </button>
            )}
            <button
              onClick={clear}
              className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink bg-transparent border-0 p-0 cursor-pointer"
            >
              {result || error ? "Dismiss" : "Clear"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-surface-alt border-b border-rule">
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
              <tr key={lead.id} className={`hover:bg-surface-alt transition-colors group ${selected.has(lead.id) ? "bg-action-soft/40" : ""}`}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                    aria-label={`Select ${lead.business_name}`}
                    className="cursor-pointer"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/leads/${lead.id}`} className="block">
                    <div className="text-[14px] font-semibold text-ink truncate">{lead.business_name}</div>
                    <div className="text-[11px] text-ink-subtle">
                      {[lead.city, countryLabel(lead.country_code)].filter(Boolean).join(" · ") || lead.category || "—"}
                    </div>
                  </Link>
                  <div className="mt-1">
                    <LeadBadges lead={lead} />
                  </div>
                </td>
                <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted truncate max-w-[200px]">
                  {lead.email ?? <span className="text-ink-subtle">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {lead.custom_domain ? (
                    <a href={`https://${lead.custom_domain}`} target="_blank" rel="noreferrer" className="mono-num text-[13px] text-positive hover:underline truncate block max-w-[220px]">
                      {lead.custom_domain}
                    </a>
                  ) : lead.demo_url ? (
                    <a href={lead.demo_url} target="_blank" rel="noreferrer" className="mono-num text-[13px] text-action hover:underline truncate block max-w-[220px]">
                      {lead.demo_url.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-ink-subtle text-[13px]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">{relativeTime(lead.updated_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/leads/${lead.id}`} className="text-ink-subtle hover:text-ink group-hover:translate-x-0.5 transition-all inline-block">
                    <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirm-with-preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(null)}>
          <div className="bg-surface border border-rule rounded-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold text-ink mb-1">Send to {preview.total} lead{preview.total === 1 ? "" : "s"}?</h2>
            <p className="text-[12.5px] text-ink-muted mb-4">Each lead goes via its best channel. Sending is in test mode until a mailbox / SMS key is connected.</p>
            <ul className="text-[13px] text-ink space-y-1 mb-5">
              <li>✉️ Email: <span className="mono-num font-semibold">{preview.emailed}</span></li>
              <li>💬 SMS: <span className="mono-num font-semibold">{preview.texted}</span></li>
              <li className="text-ink-muted">Skipped (already contacted): <span className="mono-num">{preview.skipped_already}</span></li>
              <li className="text-ink-muted">Skipped (no email or phone): <span className="mono-num">{preview.skipped_no_contact}</span></li>
            </ul>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setPreview(null)} className="text-[13px] text-ink-muted hover:text-ink bg-transparent border-0 cursor-pointer">Cancel</button>
              <button
                onClick={confirmSend}
                disabled={phase === "sending" || preview.emailed + preview.texted === 0}
                className="px-4 py-2 rounded bg-action text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {phase === "sending" ? "Sending…" : `Send ${preview.emailed + preview.texted}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>{children}</th>;
}
