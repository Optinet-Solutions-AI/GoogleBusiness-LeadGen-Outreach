/**
 * (dashboard)/inbox/page.tsx — Warm-lead inbox.
 *
 * Inputs:  call_attempts (outcome='interested') + leads (stage='replied')
 * Outputs: merged, deduped list of warm leads ready for operator follow-up
 * Used by: SideNav → /inbox
 */

import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { countryLabel } from "@/lib/data/cities";

export const dynamic = "force-dynamic";

type Offer = "build_website" | "improve_website" | "voice_agent";

interface Lead {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  phone: string | null;
  stage: string;
  call_status: string | null;
  call_segment: string | null;
  primary_offer: Offer | null;
  needs_improvement: boolean | null;
  website_score: number | null;
  website_kind: WebsiteKind | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  category_off_niche: boolean | null;
  updated_at: string;
}

type InboxLead = Lead & { reason: "interested" | "replied" | "form" };

const SELECT =
  "id,business_name,address,country_code,category,phone,stage," +
  "call_status,call_segment,primary_offer,needs_improvement,website_score," +
  "website_kind,business_status,is_service_area_only,is_franchise_flagged," +
  "category_off_niche,updated_at";

async function getInboxLeads(): Promise<InboxLead[]> {
  if (!isDbConfigured()) return [];

  return safeDb(async (db) => {
    // Source A: leads touched by an interested call outcome.
    const { data: interestedAttempts } = await db
      .from("call_attempts")
      .select("lead_id")
      .eq("outcome", "interested")
      .limit(5000);

    const interestedIds = new Set(
      (interestedAttempts ?? []).map((r: { lead_id: string }) => r.lead_id),
    );

    // Source B: email/manual replies.  Source C: connected-journey form submissions (inbox_status).
    const [interestedResult, repliedResult, formResult] = await Promise.all([
      interestedIds.size > 0
        ? db
            .from("leads")
            .select(SELECT)
            .in("id", [...interestedIds])
            .order("updated_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] }),
      db
        .from("leads")
        .select(SELECT)
        .eq("stage", "replied")
        .order("updated_at", { ascending: false })
        .limit(500),
      db
        .from("leads")
        .select(SELECT)
        .in("inbox_status", ["open", "needs_reply"])
        .order("updated_at", { ascending: false })
        .limit(500),
    ]);

    // Merge + dedupe by id. Intent precedence (low→high): replied → interested → form submitted.
    const merged = new Map<string, InboxLead>();

    for (const lead of (repliedResult.data ?? []) as unknown as Lead[]) {
      merged.set(lead.id, { ...lead, reason: "replied" });
    }
    for (const lead of (interestedResult.data ?? []) as unknown as Lead[]) {
      merged.set(lead.id, { ...lead, reason: "interested" });
    }
    for (const lead of (formResult.data ?? []) as unknown as Lead[]) {
      // A submitted intake form is the hottest signal — it wins over everything.
      merged.set(lead.id, { ...lead, reason: "form" });
    }

    // Sort by updated_at desc.
    return [...merged.values()].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, []);
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function ReasonChip({ reason }: { reason: "interested" | "replied" | "form" }) {
  if (reason === "form") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-positive text-white">
        Form in
      </span>
    );
  }
  if (reason === "interested") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-positive-soft text-positive">
        Interested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-action-soft text-action">
      Replied
    </span>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}

export default async function InboxPage() {
  const leads = await getInboxLeads();

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
          Inbox
        </h1>
        <p className="text-[13px] text-ink-muted mt-2">
          Interested calls, replies &amp; submitted forms to work.{" "}
          <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
          {leads.length === 1 ? "lead" : "leads"} waiting.
        </p>
      </header>

      {leads.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg py-16 text-center">
          <Inbox className="h-10 w-10 text-ink-subtle mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-ink text-sm font-medium mb-1">Nothing waiting</p>
          <p className="text-ink-muted text-[12.5px]">
            Interested calls and replies land here.
          </p>
        </div>
      ) : (
        <section className="bg-surface border border-rule rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-alt border-b border-rule">
              <tr>
                <Th>Business</Th>
                <Th>Phone</Th>
                <Th>Segment</Th>
                <Th>Reason</Th>
                <Th>Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-surface-alt transition-colors group">
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${lead.id}`} className="block">
                      <div className="text-[14px] font-semibold text-ink truncate">
                        {lead.business_name}
                      </div>
                      <div className="text-[11px] text-ink-subtle">
                        {[cityFromAddress(lead.address), countryLabel(lead.country_code)]
                          .filter(Boolean)
                          .join(" · ") || lead.category || "—"}
                      </div>
                    </Link>
                    <div className="mt-1">
                      <LeadBadges lead={lead} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted">
                    {lead.phone ?? <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-ink-muted">
                    {lead.call_segment ?? <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <ReasonChip reason={lead.reason} />
                  </td>
                  <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">
                    {relativeTime(lead.updated_at)}
                  </td>
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
        </section>
      )}
    </div>
  );
}
