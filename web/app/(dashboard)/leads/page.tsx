/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Fetches + filters by ?stage=<value>. The table, row selection, and the bulk
 * "Add to campaign" action live in the client <LeadsTable>.
 */

import Link from "next/link";
import { UserSearch } from "lucide-react";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { safeDb } from "@/lib/safe-db";

export const dynamic = "force-dynamic";

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

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

async function getLeads(stage: string | undefined): Promise<LeadRow[]> {
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
      return ((data ?? []) as unknown as Array<LeadRow & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
    },
    [] as LeadRow[],
  );
}

interface PageProps {
  searchParams: { stage?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const leads = await getLeads(activeStage);

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            {activeStage ? `at stage “${activeStage}”` : "across all batches"}
          </>
        }
      />

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
                  ? "bg-ink text-canvas border-ink"
                  : "bg-surface text-ink-muted border-rule hover:bg-surface-alt hover:text-ink",
              ].join(" ")}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={activeStage ? `No leads at stage “${activeStage}”` : "No leads yet"}
          description={
            activeStage
              ? "Nothing matches this filter right now."
              : "Run a batch from the Batches page to start pulling in leads."
          }
        />
      ) : (
        <LeadsTable leads={leads} activeStage={activeStage ?? null} totalCount={leads.length} />
      )}
    </div>
  );
}
