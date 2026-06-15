/**
 * (dashboard)/batches/page.tsx — Batches list.
 *
 * Server component. Fetches batches + per-stage counts directly from Supabase
 * and renders a dense, scannable table — Linear/Vercel-style. "+ New batch"
 * lives in the header.
 */

import Link from "next/link";
import { Download } from "lucide-react";
import { getDb } from "@/lib/db";
import { StatusChip } from "@/components/StatusChip";
import { ScraperBadge } from "@/components/ScraperBadge";
import { StageFunnelBar } from "@/components/StageFunnelBar";
import { relativeTime, usd } from "@/lib/format";
import { NewBatchButton } from "@/components/NewBatchButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { LiveBatchListRefresh } from "@/components/LiveBatchListRefresh";
import { FilterBar } from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterSelect";

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

      <div className="bg-surface border border-rule rounded-lg overflow-clip">
        <table className="w-full text-left border-collapse">
          <thead className="bg-surface-alt border-b border-rule sticky top-14 z-20">
            <tr>
              <Th className="w-1/4">Niche / City</Th>
              <Th>Scraper</Th>
              <Th>Status</Th>
              <Th>Scraped → qualified</Th>
              <Th className="w-40">Stage funnel</Th>
              <Th>Replies</Th>
              <Th className="text-right">Est. cost</Th>
              <Th>Created</Th>
              <Th className="w-16 text-right">CSV</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {batches.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                  No batches yet. Click{" "}
                  <span className="text-action font-semibold">+ New batch</span> above to get started.
                </td>
              </tr>
            )}
            {batches.map((b) => {
              const counts = stageCounts[b.id] ?? {};
              const replies = repliesCount(b.id);
              return (
                <tr key={b.id} className="hover:bg-surface-alt transition-colors group cursor-pointer">
                  <Td>
                    <Link href={`/batches/${b.id}`} className="block">
                      <div className="text-[14px] text-ink font-semibold capitalize">{b.niche}</div>
                      <div className="text-[12px] text-ink-subtle">{b.city}</div>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/batches/${b.id}`}><ScraperBadge scraper={b.scraper} /></Link>
                  </Td>
                  <Td>
                    <Link href={`/batches/${b.id}`}><StatusChip status={b.status} /></Link>
                  </Td>
                  <Td>
                    <Link href={`/batches/${b.id}`} className="block">
                      <ScrapeRatio
                        scraped={b.scraped_count}
                        qualified={totalLeads(b.id)}
                        status={b.status}
                      />
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/batches/${b.id}`} className="block">
                      <StageFunnelBar counts={counts} total={totalLeads(b.id) || (b.limit ?? 0)} />
                    </Link>
                  </Td>
                  <Td>
                    {replies > 0 ? (
                      <span className="bg-positive-soft text-positive px-2 py-0.5 rounded font-mono text-[11px] font-bold">
                        {replies}
                      </span>
                    ) : (
                      <span className="bg-surface-alt text-ink-subtle px-2 py-0.5 rounded font-mono text-[11px] font-bold">
                        0
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <span className="mono-num text-[13px] text-ink-muted">{usd(b.estimated_cost_usd)}</span>
                  </Td>
                  <Td>
                    <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(b.created_at)}</span>
                  </Td>
                  <Td className="text-right">
                    <a
                      href={`/api/batches/${b.id}/export`}
                      title="Export phone-reachable leads (CSV) for voice outreach"
                      className="inline-flex text-ink-subtle hover:text-action transition-colors"
                    >
                      <Download className="h-[18px] w-[18px]" />
                    </a>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}

function Td({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function ScrapeRatio({
  scraped,
  qualified,
  status,
}: {
  scraped: number | null;
  qualified: number;
  status: string;
}) {
  if (status === "queued" || status === "running") {
    return <span className="mono-num text-[12px] text-ink-subtle">—</span>;
  }
  if (scraped == null || scraped === 0) {
    return <span className="mono-num text-[12px] text-ink-subtle">no results</span>;
  }
  const allRejected = qualified === 0;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="mono-num text-[13px] font-semibold text-ink">{scraped}</span>
      <span className="text-ink-subtle text-[11px]">→</span>
      <span
        className={[
          "mono-num text-[13px] font-bold",
          allRejected ? "text-warning" : qualified > 0 ? "text-positive" : "text-ink-subtle",
        ].join(" ")}
      >
        {qualified}
      </span>
      {allRejected && (
        <span className="text-[10px] text-warning font-semibold ml-1 font-mono" title="All scraped leads had websites">
          (all had sites)
        </span>
      )}
    </div>
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
