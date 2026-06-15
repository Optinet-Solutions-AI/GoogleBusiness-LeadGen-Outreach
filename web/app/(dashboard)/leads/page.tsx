/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Fetches + filters by ?stage=, ?email=, ?verify=, and ?q=. The table, row
 * selection, and the bulk "Add to campaign" action live in the client
 * <LeadsTable>.
 */

import { unstable_cache } from "next/cache";
import { UserSearch } from "lucide-react";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { VerifyLeadsButton } from "@/components/VerifyLeadsButton";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { safeDb } from "@/lib/safe-db";
import {
  applyEmailFilter,
  parseEmailFilter,
  type EmailFilter,
  applyVerifyFilter,
  parseVerifyFilter,
  type VerifyFilter,
} from "@/lib/leads-filter";

export const dynamic = "force-dynamic";

const STAGE_OPTIONS = [
  { value: "", label: "All stages" },
  { value: "needs_email", label: "Needs email" },
  { value: "outreached", label: "Outreached" },
  { value: "replied", label: "Replied" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "improved", label: "Improved" },
  { value: "handed_over", label: "Handed over" },
  { value: "closed_won", label: "Closed won" },
  { value: "dead", label: "Dead" },
];

const EMAIL_OPTIONS = [
  { value: "", label: "All emails" },
  { value: "has", label: "Has email" },
  { value: "missing", label: "No email" },
];

const VERIFY_OPTIONS = [
  { value: "", label: "All verify" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
  { value: "invalid", label: "Invalid" },
];

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

async function getLeads(
  stage: string | undefined,
  email: EmailFilter,
  verify: VerifyFilter,
  q: string | undefined,
): Promise<LeadRow[]> {
  return safeDb(
    async (db) => {
      let query = db
        .from("leads")
        .select(
          "id,business_name,address,country_code,category,email,stage,demo_url,custom_domain,updated_at," +
            "website_url,website_kind,business_status,is_service_area_only,is_franchise_flagged,language_code," +
            "category_off_niche,primary_offer,needs_improvement,website_score,verification_status",
        )
        .order("updated_at", { ascending: false })
        .limit(200);
      if (stage) query = query.eq("stage", stage);
      query = applyEmailFilter(query, email);
      query = applyVerifyFilter(query, verify);
      if (q) {
        // Strip LIKE / PostgREST wildcards so a literal "%", "_" or "*" typed in
        // the search box matches literally instead of acting as a wildcard.
        const term = q.trim().replace(/[%_*]/g, "");
        if (term) query = query.ilike("business_name", `%${term}%`);
      }
      const { data } = await query;
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

interface PageProps {
  searchParams: { stage?: string; email?: string; verify?: string; q?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const activeEmail = parseEmailFilter(searchParams.email);
  const activeVerify = parseVerifyFilter(searchParams.verify);
  const q = searchParams.q?.trim() || undefined;
  const [leads, coverage] = await Promise.all([
    cachedGetLeads(activeStage, activeEmail, activeVerify, q),
    cachedCoverage(),
  ]);
  const pct = coverage.total > 0 ? Math.round((coverage.withEmail / coverage.total) * 100) : 0;

  const current: Record<string, string | undefined> = {
    stage: activeStage,
    email: activeEmail,
    verify: activeVerify,
    q,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{leads.length}</span>{" "}
            {activeStage ? `at stage "${activeStage}"` : "across all batches"}
            {" · "}
            <span className="mono-num text-ink font-semibold">{coverage.withEmail}</span>
            {" of "}
            <span className="mono-num text-ink font-semibold">{coverage.total}</span>{" "}
            have an email ({pct}%)
          </>
        }
        actions={<VerifyLeadsButton />}
      />

      <FilterBar>
        <FilterSelect label="Stage" param="stage" value={activeStage ?? ""} options={STAGE_OPTIONS} basePath="/leads" current={current} />
        <FilterSelect label="Email" param="email" value={activeEmail ?? ""} options={EMAIL_OPTIONS} basePath="/leads" current={current} />
        <FilterSelect label="Verify" param="verify" value={activeVerify ?? ""} options={VERIFY_OPTIONS} basePath="/leads" current={current} />
        <SearchInput value={q ?? ""} basePath="/leads" current={current} placeholder="Search business…" />
      </FilterBar>

      {leads.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={
            q
              ? `No leads matching "${q}"`
              : activeEmail === "has"
                ? "No leads with an email match"
                : activeStage
                  ? `No leads at stage "${activeStage}"`
                  : "No leads yet"
          }
          description={
            activeStage || activeEmail || activeVerify || q
              ? "Nothing matches these filters right now."
              : "Run a batch from the Batches page to start pulling in leads."
          }
        />
      ) : (
        <LeadsTable
          leads={leads}
          activeStage={activeStage ?? null}
          emailFilter={activeEmail ?? null}
          verifyFilter={activeVerify ?? null}
          totalCount={leads.length}
        />
      )}
    </div>
  );
}
