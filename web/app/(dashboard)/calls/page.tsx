/**
 * (dashboard)/calls/page.tsx — Voice outreach call queue.
 *
 * Two groups:
 *   • Queued — leads with an open call (call_status='queued'/'dialing'); the
 *     operator reads the generated script and dials.
 *   • Ready to call — deployed leads not yet queued (call_status='none').
 *
 * Filter by ?offer=build_website|improve_website|voice_agent. Click a row to
 * open the lead and work the Voice outreach panel.
 */

import Link from "next/link";
import { ChevronRight, PhoneCall } from "lucide-react";
import { LeadBadges, type WebsiteKind } from "@/components/LeadBadges";
import { StageChip } from "@/components/StageChip";
import { safeDb } from "@/lib/safe-db";
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
  demo_url: string | null;
  call_status: string | null;
  updated_at: string;
  website_kind: WebsiteKind | null;
  business_status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only: boolean | null;
  is_franchise_flagged: boolean | null;
  primary_offer: Offer | null;
  needs_improvement: boolean | null;
  website_score: number | null;
}

const OFFER_PILLS: { label: string; offer?: Offer }[] = [
  { label: "All" },
  { label: "Build", offer: "build_website" },
  { label: "Improve", offer: "improve_website" },
  { label: "Voice agent", offer: "voice_agent" },
];

const SELECT =
  "id,business_name,address,country_code,category,phone,stage,demo_url,call_status,updated_at," +
  "website_kind,business_status,is_service_area_only,is_franchise_flagged," +
  "primary_offer,needs_improvement,website_score";

async function getQueue(offer: Offer | undefined): Promise<{ queued: Lead[]; ready: Lead[] }> {
  return safeDb(
    async (db) => {
      // Queued / dialing — an open call to work.
      let queuedQ = db
        .from("leads")
        .select(SELECT)
        .in("call_status", ["queued", "dialing"])
        .order("updated_at", { ascending: false })
        .limit(200);
      if (offer) queuedQ = queuedQ.eq("primary_offer", offer);

      // Deployed but not yet called — ready to queue.
      let readyQ = db
        .from("leads")
        .select(SELECT)
        .eq("stage", "deployed")
        .eq("call_status", "none")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (offer) readyQ = readyQ.eq("primary_offer", offer);

      const [{ data: queued }, { data: ready }] = await Promise.all([queuedQ, readyQ]);
      return {
        queued: (queued ?? []) as unknown as Lead[],
        ready: (ready ?? []) as unknown as Lead[],
      };
    },
    { queued: [], ready: [] },
  );
}

interface PageProps {
  searchParams: { offer?: Offer };
}

export default async function CallsPage({ searchParams }: PageProps) {
  const offer = searchParams.offer;
  const { queued, ready } = await getQueue(offer);

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Call queue</h1>
        <p className="text-[13px] text-ink-muted mt-2">
          <span className="mono-num text-ink font-semibold">{queued.length}</span> queued ·{" "}
          <span className="mono-num text-ink font-semibold">{ready.length}</span> ready to call
        </p>
      </header>

      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-2">
        {OFFER_PILLS.map((p) => {
          const active = (offer ?? "") === (p.offer ?? "");
          return (
            <Link
              key={p.label}
              href={p.offer ? `/calls?offer=${p.offer}` : "/calls"}
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

      <CallTable title="Queued — read script + dial" leads={queued} emptyHint="No open calls. Queue one from a deployed lead." />
      <div className="h-6" />
      <CallTable title="Ready to call" leads={ready} emptyHint="No deployed leads waiting. Build a site first." />
    </div>
  );
}

function CallTable({ title, leads, emptyHint }: { title: string; leads: Lead[]; emptyHint: string }) {
  return (
    <section className="bg-surface border border-rule rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-rule flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        <h2 className="eyebrow">{title}</h2>
        <span className="ml-auto mono-num text-[11px] bg-surface-alt px-2 py-0.5 rounded text-ink-muted">
          {leads.length}
        </span>
      </div>
      {leads.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-ink-muted">{emptyHint}</p>
      ) : (
        <table className="w-full text-left">
          <thead className="bg-surface-alt border-b border-rule">
            <tr>
              <Th>Business</Th>
              <Th>Phone</Th>
              <Th>Stage</Th>
              <Th>Call status</Th>
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
                <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                <td className="px-4 py-2.5 text-[12px] text-ink-muted">
                  {(lead.call_status ?? "none").replaceAll("_", " ")}
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
      )}
    </section>
  );
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}
