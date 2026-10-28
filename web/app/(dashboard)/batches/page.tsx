/**
 * (dashboard)/batches/page.tsx — Batches list.
 *
 * Server component. Fetches one page of batches + their per-stage counts
 * directly from Supabase and renders a dense, scannable table. Filters
 * (?status=, ?scraper=), search (?q= on niche/city), sort (?sort=&dir=, keys
 * whitelisted in BATCH_SORTS) and paging (?page=&per=) all run server-side.
 * "+ New batch" lives in the header.
 */

import { getDb } from "@/lib/db";
import { NewBatchButton } from "@/components/NewBatchButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { LiveBatchListRefresh } from "@/components/LiveBatchListRefresh";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { parseTableParams, type SortState } from "@/lib/table";
import { BatchesTable, type BatchRow } from "@/components/BatchesTable";
import { reapStuckBatches } from "@/lib/pipeline/reap-stuck";

export const dynamic = "force-dynamic";

interface Batch {
  id: string;
  niche: string;
  city: string;
  scraper: string;
  status: string;
  limit: number | null;
  estimated_cost_usd: number | null;
  scraped_count: number | null;
  rejected_count: number | null;
  created_at: string;
}

type StatusFilter = "all" | "queued" | "running" | "done" | "failed";
type ScraperFilter = "" | "apify" | "google_places" | "outscraper";

/** Table column key -> batches column it sorts by. Only these keys are accepted from the URL. */
const BATCH_SORTS: Record<string, string> = {
  niche_city: "niche",
  scraper: "scraper",
  status: "status",
  scraped_qualified: "scraped_count",
  est_cost: "estimated_cost_usd",
  created: "created_at",
};

async function getBatches(opts: {
  status: StatusFilter;
  scraper: ScraperFilter;
  q: string | undefined;
  sort: SortState | null;
  page: number;
  per: number;
}): Promise<{ rows: Batch[]; total: number }> {
  try {
    const sortCol = opts.sort ? BATCH_SORTS[opts.sort.key] : undefined;
    let q = getDb().from("batches").select("*", { count: "exact" });
    q = sortCol
      ? q.order(sortCol, { ascending: opts.sort!.dir === "asc", nullsFirst: false })
      : q.order("created_at", { ascending: false });
    q = q.order("id", { ascending: true }); // stable tiebreak so pages never overlap
    if (opts.status !== "all") q = q.eq("status", opts.status);
    if (opts.scraper) q = q.eq("scraper", opts.scraper);
    // Strip wildcard + PostgREST filter-syntax characters before building the or().
    const term = (opts.q ?? "").trim().replace(/[%_*,()"\\:]/g, "");
    if (term) q = q.or(`niche.ilike.%${term}%,city.ilike.%${term}%`);
    const from = (opts.page - 1) * opts.per;
    const { data, error, count } = await q.range(from, from + opts.per - 1);
    if (error) return { rows: [], total: 0 };
    return { rows: (data ?? []) as Batch[], total: count ?? (data ?? []).length };
  } catch {
    return { rows: [], total: 0 };
  }
}

async function getStageCountsByBatch(batchIds: string[]): Promise<Record<string, Record<string, number>>> {
  if (batchIds.length === 0) return {};
  try {
    const { data } = await getDb()
      .from("leads")
      .select("batch_id,stage")
      .in("batch_id", batchIds)
      .neq("qualified", false);
    const out: Record<string, Record<string, number>> = {};
    for (const row of (data ?? []) as { batch_id: string; stage: string }[]) {
      out[row.batch_id] ??= {};
      out[row.batch_id][row.stage] = (out[row.batch_id][row.stage] ?? 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}

interface PageProps {
  searchParams: {
    status?: string;
    scraper?: string;
    q?: string;
    sort?: string;
    dir?: string;
    page?: string;
    per?: string;
  };
}

export default async function BatchesPage({ searchParams }: PageProps) {
  const filter: StatusFilter = (() => {
    const s = searchParams.status;
    if (s === "queued" || s === "running" || s === "done" || s === "failed") return s;
    return "all";
  })();
  const scraper: ScraperFilter = (() => {
    const s = searchParams.scraper;
    if (s === "apify" || s === "google_places" || s === "outscraper") return s;
    return "";
  })();
  const q = searchParams.q?.trim() || undefined;
  const table = parseTableParams(searchParams, Object.keys(BATCH_SORTS), { defaultPer: 25, maxPer: 100 });

  // Reap stuck batches (dead scrape process, stale heartbeat) alongside the
  // list fetch (not before it) so the write doesn't sit on the critical path.
  // Worst case a just-stuck batch shows once more as 'running' and flips next
  // load.
  const [, { rows: batches, total }] = await Promise.all([
    reapStuckBatches().catch(() => []),
    getBatches({ status: filter, scraper, q, sort: table.sort, page: table.page, per: table.per }),
  ]);
  const stageCounts = await getStageCountsByBatch(batches.map((b) => b.id));
  const hasRunning = batches.some((b) => b.status === "running");

  const totalLeads = (id: string) =>
    Object.values(stageCounts[id] ?? {}).reduce((s, n) => s + n, 0);

  const repliesCount = (id: string) => (stageCounts[id]?.replied ?? 0);

  const rows: BatchRow[] = batches.map((b) => {
    const counts = stageCounts[b.id] ?? {};
    const qualified = totalLeads(b.id);
    return {
      id: b.id,
      niche: b.niche,
      city: b.city,
      scraper: b.scraper,
      status: b.status,
      scraped_count: b.scraped_count,
      qualified,
      counts,
      total: qualified || (b.limit ?? 0),
      replies: repliesCount(b.id),
      estimated_cost_usd: b.estimated_cost_usd,
      created_at: b.created_at,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Pipeline operations"
        title="Batches"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{total}</span>{" "}
            {total === 1 ? "batch" : "batches"}
            {hasRunning && (
              <>
                {" · "}
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-urgent align-middle" />
                  <LiveBatchListRefresh />
                </span>
              </>
            )}
          </>
        }
        actions={<NewBatchButton />}
      />

      <BatchFilters
        status={filter}
        scraper={scraper}
        q={q}
        sort={table.sort}
        per={searchParams.per ? table.per : undefined}
      />

      <p className="mb-2 text-[11px] text-ink-subtle">
        Click a column header to sort · drag it to reorder · the header stays put as you scroll.
      </p>
      <BatchesTable rows={rows} sort={table.sort} page={table.page} per={table.per} total={total} />
    </>
  );
}

const BATCH_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

const BATCH_SCRAPER_OPTIONS = [
  { value: "", label: "All" },
  { value: "apify", label: "Apify" },
  { value: "google_places", label: "Google Places" },
  { value: "outscraper", label: "Outscraper" },
];

function BatchFilters({
  status,
  scraper,
  q,
  sort,
  per,
}: {
  status: StatusFilter;
  scraper: ScraperFilter;
  q: string | undefined;
  sort: SortState | null;
  per: number | undefined;
}) {
  // Filters keep the sort + page size but drop ?page, so a new filter starts on page 1.
  const current: Record<string, string | undefined> = {
    status: status === "all" ? undefined : status,
    scraper: scraper || undefined,
    q,
    sort: sort?.key,
    dir: sort?.dir,
    per: per ? String(per) : undefined,
  };
  return (
    <FilterBar>
      <FilterSelect
        label="Status"
        param="status"
        value={status === "all" ? "" : status}
        options={BATCH_STATUS_OPTIONS}
        basePath="/batches"
        current={current}
      />
      <FilterSelect
        label="Scraper"
        param="scraper"
        value={scraper}
        options={BATCH_SCRAPER_OPTIONS}
        basePath="/batches"
        current={current}
      />
      <SearchInput value={q ?? ""} basePath="/batches" current={current} placeholder="Search niche or city…" />
    </FilterBar>
  );
}
