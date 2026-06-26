/**
 * (dashboard)/batches/page.tsx — Batches list.
 *
 * Server component. Fetches batches + per-stage counts directly from Supabase
 * and renders a dense, scannable table — Linear/Vercel-style. "+ New batch"
 * lives in the header.
 */

import { getDb } from "@/lib/db";
import { NewBatchButton } from "@/components/NewBatchButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { LiveBatchListRefresh } from "@/components/LiveBatchListRefresh";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { BatchesTable, type BatchRow } from "@/components/BatchesTable";

export const dynamic = "force-dynamic";

// Anything still `running` past this cutoff is almost certainly a zombie —
// orchestrator was killed mid-flight (Vercel function timeout, container
// crash, etc.) and never reached its final status update. The list page
// auto-flips these to `failed` so the dashboard reflects reality.
const STUCK_BATCH_CUTOFF_MS = 10 * 60 * 1000; // 10 min

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

async function reapStaleBatches(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_BATCH_CUTOFF_MS).toISOString();
    await getDb()
      .from("batches")
      .update({
        status: "failed",
        last_error: "timeout — orchestrator did not finish within 10 minutes",
      })
      .eq("status", "running")
      .lt("updated_at", cutoff);
  } catch {
    /* best-effort */
  }
}

async function getBatches(filter: StatusFilter): Promise<Batch[]> {
  try {
    let q = getDb()
      .from("batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as Batch[];
  } catch {
    return [];
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
  searchParams: { status?: string };
}

export default async function BatchesPage({ searchParams }: PageProps) {
  const filter: StatusFilter = (() => {
    const s = searchParams.status;
    if (s === "queued" || s === "running" || s === "done" || s === "failed") return s;
    return "all";
  })();

  // Reap stale batches alongside the list fetch (not before it) so the write
  // doesn't sit on the critical path. Worst case a just-stuck batch shows once
  // more as 'running' and flips next load.
  const [, batches] = await Promise.all([reapStaleBatches(), getBatches(filter)]);
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
            <span className="mono-num text-ink font-semibold">{batches.length}</span>{" "}
            {batches.length === 1 ? "batch" : "batches"} in view
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

      <FilterPills active={filter} />

      <p className="mb-2 text-[11px] text-ink-subtle">
        Drag a column header to reorder · scroll inside the table; the header stays put.
      </p>
      <BatchesTable rows={rows} />
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

function FilterPills({ active }: { active: StatusFilter }) {
  const value = active === "all" ? "" : active;
  const current: Record<string, string | undefined> = {
    status: active === "all" ? undefined : active,
  };
  return (
    <FilterBar>
      <FilterSelect
        label="Status"
        param="status"
        value={value}
        options={BATCH_STATUS_OPTIONS}
        basePath="/batches"
        current={current}
      />
    </FilterBar>
  );
}
