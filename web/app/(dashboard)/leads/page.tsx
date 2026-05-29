/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Table of every lead, filterable by ?stage=<value>. Useful for triaging
 * `needs_email`, browsing `replied`, or finding handed-over customers.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { safeDb } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";

export const dynamic = "force-dynamic";

interface Lead {
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

const FILTER_PILLS: { label: string; stage?: string }[] = [
  { label: "All" },
  { label: "Needs email", stage: "needs_email" },
  { label: "Outreached", stage: "outreached" },
  { label: "Replied", stage: "replied" },
  { label: "Meeting booked", stage: "meeting_booked" },
  { label: "Improved", stage: "improved" },
  { label: "Handed over", stage: "handed_over" },
  { label: "Closed won", stage: "closed_won" },
  { label: "Dead", stage: "dead" },
];

async function getLeads(stage: string | undefined): Promise<Lead[]> {
  return safeDb(
    async (db) => {
      let q = db
        .from("leads")
        .select(
          "id,business_name,address,country_code,category,email,stage,demo_url,custom_domain,updated_at," +
            "website_url,website_kind,business_status,is_service_area_only,is_franchise_flagged,language_code," +
            "category_off_niche,primary_offer,needs_improvement,website_score",
        )
        .order("updated_at", { ascending: false })
        .limit(200);
      if (stage) q = q.eq("stage", stage);
      const { data } = await q;
      return ((data ?? []) as unknown as Array<Lead & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
    },
    [] as Lead[],
  );
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

interface PageProps {
  searchParams: { stage?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const leads = await getLeads(activeStage);

  return (
    <div>
      <header className="flex items-end justify-between mb-6 gap-4">
        <div>
          <p className="eyebrow mb-2">Pipeline</p>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Leads</h1>
          <p className="text-[13px] text-ink-muted mt-2">
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            {activeStage ? `at stage “${activeStage}”` : "across all batches"}
          </p>
        </div>
      </header>

      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-2">
        {FILTER_PILLS.map((p) => {
          const active = (activeStage ?? "") === (p.stage ?? "");
          return (
            <Link
              key={p.label}
              href={p.stage ? `/leads?stage=${p.stage}` : "/leads"}
              className={[
                "px-3 py-1.5 rounded text-[11px] uppercase tracking-[0.14em] font-semibold font-mono transition-colors border flex-none",
                active
                  ? "bg-action-soft text-action border-action/40"
                  : "bg-surface text-ink-muted border-rule hover:bg-surface-alt hover:text-ink",
              ].join(" ")}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {leads.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg py-16 text-center">
          <p className="text-[13px] text-ink-muted">
            {activeStage
              ? `No leads at stage “${activeStage}”.`
              : "No leads yet. Run a batch from the Batches page to get started."}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-rule rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-alt border-b border-rule">
              <tr>
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
                <tr key={lead.id} className="hover:bg-surface-alt transition-colors group">
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${lead.id}`} className="block">
                      <div className="text-[14px] font-semibold text-ink truncate">{lead.business_name}</div>
                      <div className="text-[11px] text-ink-subtle">
                        {[lead.city, countryLabel(lead.country_code)].filter(Boolean).join(" · ") ||
                          lead.category ||
                          "—"}
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
                      <a
                        href={`https://${lead.custom_domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono-num text-[13px] text-positive hover:underline truncate block max-w-[220px]"
                      >
                        {lead.custom_domain}
                      </a>
                    ) : lead.demo_url ? (
                      <a
                        href={lead.demo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mono-num text-[13px] text-action hover:underline truncate block max-w-[220px]"
                      >
                        {lead.demo_url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="text-ink-subtle text-[13px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">{relativeTime(lead.updated_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-ink-subtle hover:text-ink group-hover:translate-x-0.5 transition-all inline-block"
                    >
                      <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}
