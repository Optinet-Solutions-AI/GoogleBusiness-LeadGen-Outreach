/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Fetches + filters by ?stage=<value>. The table, row selection, and the bulk
 * "Send via best channel" action live in the client <LeadsTable>.
 */

import Link from "next/link";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
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
        <LeadsTable leads={leads} />
      )}
    </div>
  );
}
