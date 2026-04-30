/**
 * (dashboard)/page.tsx — Batches list (home route).
 *
 * Server component. Fetches batches + per-stage counts directly from Supabase.
 * The "+ New batch" button opens NewBatchModal (client component) which
 * lives at /batches/new (intercepted via the URL but rendered as a modal
 * via Next.js' parallel routes pattern — kept simple for now: button
 * navigates to /batches/new which is its own page that POSTs back).
 */

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { getDb } from "@/lib/db";
import { StatusChip } from "@/components/StatusChip";
import { ScraperBadge } from "@/components/ScraperBadge";
import { StageFunnelBar } from "@/components/StageFunnelBar";
import { relativeTime, usd } from "@/lib/format";
import { NewBatchButton } from "@/components/NewBatchButton";
import { LiveBatchListRefresh } from "@/components/LiveBatchListRefresh";

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
  // Single idempotent UPDATE — Postgres handles the WHERE filter so this
  // is essentially free even when there's nothing to clean up.
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
    // Reaping is best-effort. If the column is missing or the table is
    // unreachable, fall through to the regular SELECT.
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
      .in("batch_id", batchIds);
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

  // Reap zombie `running` batches before we read — keeps the UI honest.
  await reapStaleBatches();

  const batches = await getBatches(filter);
  const stageCounts = await getStageCountsByBatch(batches.map((b) => b.id));
  const hasRunning = batches.some((b) => b.status === "running");

  const totalLeads = (id: string) =>
    Object.values(stageCounts[id] ?? {}).reduce((s, n) => s + n, 0);

  const repliesCount = (id: string) => (stageCounts[id]?.replied ?? 0);

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-headline-sm text-slate-900 tracking-tight">Batches</h1>
          <p className="text-body-sm text-slate-500">Manage and monitor your lead-generation operations</p>
          {hasRunning && (
            <div className="mt-1.5">
              <LiveBatchListRefresh />
            </div>
          )}
        </div>
        <NewBatchButton />
      </div>

      <FilterPills active={filter} />

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th className="w-1/4">Niche / City</Th>
              <Th>Scraper</Th>
              <Th>Status</Th>
              <Th>Scraped → qualified</Th>
              <Th className="w-40">Stage funnel</Th>
              <Th>Replies</Th>
              <Th className="text-right">Est. cost</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {batches.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  No batches yet. Click <span className="text-brand font-semibold">+ New batch</span> above to get started.
                </td>
              </tr>
            )}
            {batches.map((b) => {
              const counts = stageCounts[b.id] ?? {};
              const replies = repliesCount(b.id);
              return (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors group cursor-pointer">
                  <Td>
                    <Link href={`/batches/${b.id}`} className="block">
                      <div className="text-body-base text-slate-900 font-semibold capitalize">{b.niche}</div>
                      <div className="text-body-sm text-slate-400">{b.city}</div>
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
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-mono text-[11px] font-bold">
                        {replies}
                      </span>
                    ) : (
                      <span className="bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-mono text-[11px] font-bold">0</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <span className="font-mono text-[13px] text-slate-600">{usd(b.estimated_cost_usd)}</span>
                  </Td>
                  <Td>
                    <span className="text-body-sm text-slate-400">{relativeTime(b.created_at)}</span>
                  </Td>
                  <Td className="text-right">
                    <button className="text-slate-400 hover:text-slate-900">
                      <MoreVertical className="h-[18px] w-[18px]" />
                    </button>
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
    <th className={`px-4 py-3 text-label-caps text-slate-500 uppercase tracking-widest ${className}`}>
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
    return <span className="text-[12px] text-slate-400 font-mono">—</span>;
  }
  if (scraped == null || scraped === 0) {
    return <span className="text-[12px] text-slate-400 font-mono">no results</span>;
  }
  const allRejected = qualified === 0;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[13px] font-semibold text-slate-700">{scraped}</span>
      <span className="text-slate-400 text-[11px]">→</span>
      <span
        className={[
          "font-mono text-[13px] font-bold",
          allRejected ? "text-amber-600" : qualified > 0 ? "text-emerald-600" : "text-slate-400",
        ].join(" ")}
      >
        {qualified}
      </span>
      {allRejected && (
        <span className="text-[10px] text-amber-600 font-semibold ml-1" title="All scraped leads had websites">
          (all had sites)
        </span>
      )}
    </div>
  );
}

function FilterPills({ active }: { active: StatusFilter }) {
  const PILLS: { label: string; status: StatusFilter; href: string }[] = [
    { label: "All",     status: "all",     href: "/" },
    { label: "Running", status: "running", href: "/?status=running" },
    { label: "Done",    status: "done",    href: "/?status=done" },
    { label: "Failed",  status: "failed",  href: "/?status=failed" },
  ];
  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
      {PILLS.map((p) => {
        const isActive = active === p.status;
        return (
          <Link
            key={p.status}
            href={p.href}
            className={[
              "px-4 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-semibold transition-colors",
              isActive
                ? "bg-brand text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            ].join(" ")}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
