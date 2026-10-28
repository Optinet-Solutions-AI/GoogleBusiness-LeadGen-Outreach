/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Fetches + filters by ?stage=, ?email=, ?verify=, and ?q=, and pages + sorts
 * server-side via ?page=, ?per=, ?sort=, ?dir= (sort keys whitelisted in
 * LEAD_SORTS). The table, row selection, and the bulk "Add to campaign" action
 * live in the client <LeadsTable>.
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
  applyNameSearch,
} from "@/lib/leads-filter";
import { parseTableParams, type SortState } from "@/lib/table";

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

/** Table column key -> leads column it sorts by. Only these keys are accepted from the URL. */
const LEAD_SORTS: Record<string, string> = {
  business_city: "business_name",
  stage: "stage",
  email: "email",
  updated: "updated_at",
};

async function getLeads(
  stage: string | undefined,
  email: EmailFilter,
  verify: VerifyFilter,
  q: string | undefined,
  sort: SortState | null,
  page: number,
  per: number,
): Promise<{ rows: LeadRow[]; total: number }> {
  return safeDb(
    async (db) => {
      const sortCol = sort ? LEAD_SORTS[sort.key] : undefined;
      let query = db
        .from("leads")
        .select(
          "id,business_name,address,country_code,category,email,stage,demo_url,custom_domain,updated_at,place_id," +
            "website_url,website_kind,business_status,is_service_area_only,is_franchise_flagged,language_code," +
            "category_off_niche,primary_offer,needs_improvement,website_score,verification_status,call_segment," +
            "seq_status,seq_step,screenshot_url",
          { count: "exact" },
        );
      query = sortCol
        ? query.order(sortCol, { ascending: sort!.dir === "asc", nullsFirst: false })
        : query.order("updated_at", { ascending: false });
      query = query.order("id", { ascending: true }); // stable tiebreak so pages never overlap
      if (stage) query = query.eq("stage", stage);
      query = applyEmailFilter(query, email);
      query = applyVerifyFilter(query, verify);
      query = applyNameSearch(query, q);
      const from = (page - 1) * per;
      const { data, count } = await query.range(from, from + per - 1);
      const rows = ((data ?? []) as unknown as Array<LeadRow & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
      return { rows, total: count ?? rows.length };
    },
    { rows: [] as LeadRow[], total: 0 },
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
  searchParams: {
    stage?: string;
    email?: string;
    verify?: string;
    q?: string;
    sort?: string;
    dir?: string;
    page?: string;
    per?: string;
  };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const activeEmail = parseEmailFilter(searchParams.email);
  const activeVerify = parseVerifyFilter(searchParams.verify);
  const q = searchParams.q?.trim() || undefined;
  const table = parseTableParams(searchParams, Object.keys(LEAD_SORTS), { defaultPer: 50, maxPer: 200 });
  const [{ rows: leads, total }, coverage] = await Promise.all([
    cachedGetLeads(activeStage, activeEmail, activeVerify, q, table.sort, table.page, table.per),
    cachedCoverage(),
  ]);
  const pct = coverage.total > 0 ? Math.round((coverage.withEmail / coverage.total) * 100) : 0;

  // Filters keep the sort + page size but drop ?page, so a new filter starts on page 1.
  const current: Record<string, string | undefined> = {
    stage: activeStage,
    email: activeEmail,
    verify: activeVerify,
    q,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    per: searchParams.per ? String(table.per) : undefined,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{total}</span>{" "}
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

      {total === 0 ? (
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
          totalCount={total}
          searchTerm={q ?? null}
          sort={table.sort}
          page={table.page}
          per={table.per}
        />
      )}
    </div>
  );
}
