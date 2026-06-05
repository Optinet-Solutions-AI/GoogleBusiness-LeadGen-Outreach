/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Fetches + filters by ?stage=<value>. The table, row selection, and the bulk
 * "Add to campaign" action live in the client <LeadsTable>.
 */

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { UserSearch } from "lucide-react";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { safeDb } from "@/lib/safe-db";
import { applyEmailFilter, parseEmailFilter, type EmailFilter } from "@/lib/leads-filter";

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

async function getLeads(stage: string | undefined, email: EmailFilter): Promise<LeadRow[]> {
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
      q = applyEmailFilter(q, email);
      const { data } = await q;
      return ((data ?? []) as unknown as Array<LeadRow & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
    },
    [] as LeadRow[],
  );
}

/** Overall email coverage across all leads (independent of the current filter). */
async function getEmailCoverage(): Promise<{ total: number; withEmail: number }> {
  return safeDb(
    async (db) => {
      const total = await db.from("leads").select("id", { count: "exact", head: true });
      const withEmail = await db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .not("email", "is", null)
        .neq("email", "");
      return { total: total.count ?? 0, withEmail: withEmail.count ?? 0 };
    },
    { total: 0, withEmail: 0 },
  );
}

// Cache the list + (expensive) full-table coverage counts for a short window so
// repeat visits are instant. Keyed by filter args; ~20-30s stale is fine for a
// lead list (new scraped leads still appear within the window).
const cachedGetLeads = unstable_cache(getLeads, ["leads-list"], { revalidate: 20 });
const cachedCoverage = unstable_cache(getEmailCoverage, ["leads-coverage"], { revalidate: 30 });

const EMAIL_PILLS: { label: string; email?: "has" | "missing" }[] = [
  { label: "All" },
  { label: "Has email", email: "has" },
  { label: "No email", email: "missing" },
];

interface PageProps {
  searchParams: { stage?: string; email?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const activeEmail = parseEmailFilter(searchParams.email);
  const [leads, coverage] = await Promise.all([
    cachedGetLeads(activeStage, activeEmail),
    cachedCoverage(),
  ]);
  const pct = coverage.total > 0 ? Math.round((coverage.withEmail / coverage.total) * 100) : 0;

  /** Build a /leads URL preserving the other active filter. */
  const urlWith = (next: { stage?: string; email?: string }) => {
    const params = new URLSearchParams();
    const stage = "stage" in next ? next.stage : activeStage;
    const email = "email" in next ? next.email : activeEmail;
    if (stage) params.set("stage", stage);
    if (email) params.set("email", email);
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            {activeStage ? `at stage “${activeStage}”` : "across all batches"}
            {" · "}
            <span className="mono-num text-ink font-semibold">{coverage.withEmail}</span>
            {" of "}
            <span className="mono-num text-ink font-semibold">{coverage.total}</span>{" "}
            have an email ({pct}%)
          </>
        }
      />

      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-2">
        {FILTER_PILLS.map((p) => {
          const active = (activeStage ?? "") === (p.stage ?? "");
          return (
            <Link
              key={p.label}
              href={urlWith({ stage: p.stage })}
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

      <div className="flex items-center gap-1.5 mb-6">
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-subtle mr-1">Email</span>
        {EMAIL_PILLS.map((p) => {
          const active = (activeEmail ?? "") === (p.email ?? "");
          return (
            <Link
              key={p.label}
              href={urlWith({ email: p.email })}
              className={[
                "px-3 py-1.5 rounded text-[11px] font-semibold transition-colors border flex-none",
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
          title={
            activeEmail === "has"
              ? "No leads with an email match"
              : activeStage
                ? `No leads at stage “${activeStage}”`
                : "No leads yet"
          }
          description={
            activeStage || activeEmail
              ? "Nothing matches these filters right now."
              : "Run a batch from the Batches page to start pulling in leads."
          }
        />
      ) : (
        <LeadsTable
          leads={leads}
          activeStage={activeStage ?? null}
          emailFilter={activeEmail ?? null}
          totalCount={leads.length}
        />
      )}
    </div>
  );
}
