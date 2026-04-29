/**
 * (dashboard)/batches/[id]/page.tsx — Batch detail.
 *
 * 4 stat cards, a stage funnel, and a filterable lead table for this batch.
 */

import Link from "next/link";
import { RefreshCw, MoreVertical } from "lucide-react";
import { notFound } from "next/navigation";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { REJECTION_REASON_LABEL } from "@/lib/filters";
import { StatusChip } from "@/components/StatusChip";
import { StageChip } from "@/components/StageChip";
import { StageFunnel } from "@/components/StageFunnel";
import { StatCard } from "@/components/StatCard";
import { BatchProgressPoller } from "@/components/BatchProgressPoller";

export const dynamic = "force-dynamic";

interface Batch {
  id: string;
  niche: string;
  city: string;
  status: string;
  limit: number | null;
  template_slug: string;
  scraper: string;
  scraped_count: number | null;
  rejected_count: number | null;
  rejection_reasons: Record<string, number> | null;
  updated_at: string;
}

interface BatchLead {
  id: string;
  business_name: string;
  address: string | null;
  stage: string;
  email: string | null;
  demo_url: string | null;
  last_error: string | null;
  created_at: string;
}

export default async function BatchDetailPage({ params }: { params: { id: string } }) {
  if (!isDbConfigured()) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
        <h1 className="text-headline-sm text-slate-900 mb-2">Supabase not configured</h1>
        <p className="text-sm text-slate-500">Set SUPABASE_URL + SUPABASE_SERVICE_KEY in Vercel to load batch detail.</p>
      </div>
    );
  }

  const batch = await safeDb<Batch | null>(async (db) => {
    const { data } = await db.from("batches").select("*").eq("id", params.id).single();
    return data as Batch | null;
  }, null);
  if (!batch) notFound();

  const leads = await safeDb<BatchLead[]>(
    async (db) => {
      const { data } = await db
        .from("leads")
        .select("id,business_name,address,stage,email,demo_url,last_error,created_at")
        .eq("batch_id", params.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as BatchLead[];
    },
    [],
  );

  const counts: Record<string, number> = {};
  for (const lead of leads) counts[lead.stage] = (counts[lead.stage] ?? 0) + 1;

  const qualified = leads.length;            // saved leads = passed the qualifier
  const scraped = batch.scraped_count ?? qualified;  // total Google returned
  const rejected = batch.rejected_count ?? 0;
  const deployed = (counts.deployed ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) +
                   (counts.meeting_booked ?? 0) + (counts.meeting_done ?? 0) +
                   (counts.improved ?? 0) + (counts.handed_over ?? 0) + (counts.closed_won ?? 0);
  const replies = counts.replied ?? 0;
  const allRejected = scraped > 0 && qualified === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <nav className="flex items-center text-xs font-medium text-slate-400 mb-1">
            <Link href="/" className="hover:text-slate-700">Batches</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-600 font-mono">{batch.id.slice(0, 8)}</span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-brand capitalize">
            {batch.niche} <span className="text-slate-400 font-normal">/</span> {batch.city}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <StatusChip status={batch.status} />
          <RerunButton id={batch.id} />
        </div>
      </header>

      {/* RUNNING — only show the progress banner. Hide stats/funnel/table —
          they're empty until the scrape lands. */}
      {batch.status === "running" && (
        <BatchProgressPoller batchId={batch.id} startedAt={batch.updated_at} />
      )}

      {/* QUEUED — same idea, simpler message */}
      {batch.status === "queued" && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[13px] text-slate-700">
          Queued. Click <span className="font-semibold">Re-run</span> above to start the scrape.
        </div>
      )}

      {/* FAILED — error state with retry */}
      {batch.status === "failed" && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-[13px] text-rose-800">
          <p className="font-bold mb-1">This batch failed.</p>
          <p>Click <span className="font-semibold">Re-run</span> above to retry, or check the build logs in Vercel for details.</p>
        </div>
      )}

      {/* DONE — show all the detail */}
      {batch.status === "done" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Scraped" value={scraped} hint={`${batch.limit ?? 0} requested`} />
            <StatCard
              label="Qualified"
              value={qualified}
              emphasis
              hint={scraped > 0 ? `${Math.round((qualified / scraped) * 100)}% pass rate` : undefined}
              hintTone={allRejected ? "warning" : "neutral"}
            />
            <StatCard label="Deployed" value={deployed} emphasis hint={qualified > 0 ? `${Math.round((deployed / qualified) * 100)}% live` : undefined} />
            <StatCard label="Replies" value={replies} hint={deployed > 0 ? `${((replies / deployed) * 100).toFixed(1)}% rate` : undefined} hintTone="positive" />
          </div>

          {allRejected && (
            <RejectionBreakdown
              niche={batch.niche}
              scraped={scraped}
              reasons={batch.rejection_reasons ?? {}}
            />
          )}

          {qualified > 0 && <StageFunnel counts={counts} />}
        </>
      )}

      {/* Leads table only when we have something to show */}
      {qualified > 0 && (
      <section>
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-4">
          <div className="flex space-x-6">
            <button className="text-sm font-semibold text-brand border-b-2 border-brand pb-2 px-1">
              All leads ({qualified})
            </button>
            {(counts.needs_email ?? 0) > 0 && (
              <span className="text-sm text-slate-500 pb-2 px-1">Needs email ({counts.needs_email})</span>
            )}
            {replies > 0 && (
              <span className="text-sm text-slate-500 pb-2 px-1">Replied ({replies})</span>
            )}
            {(counts.dead ?? 0) > 0 && (
              <span className="text-sm text-slate-500 pb-2 px-1">Dead ({counts.dead})</span>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>Business / city</Th>
                <Th>Stage</Th>
                <Th>Email</Th>
                <Th>Demo URL</Th>
                <Th>Last error</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {leads.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">
                    No leads scraped yet.
                  </td>
                </tr>
              )}
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${lead.id}`} className="block">
                      <div className="text-body-base font-semibold text-slate-800">{lead.business_name}</div>
                      <div className="text-[11px] text-slate-400">{lead.address ?? "—"}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                  <td className="px-4 py-2.5 text-body-sm font-mono text-slate-600">
                    {lead.email ?? <span className="italic text-slate-400">needs email</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.demo_url ? (
                      <a href={lead.demo_url} target="_blank" rel="noreferrer" className="text-body-sm text-brand hover:underline truncate block max-w-[200px]">
                        {lead.demo_url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : <span className="text-slate-400 text-sm">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.last_error ? (
                      <span className="text-[12px] text-rose-600 line-clamp-1 max-w-[260px] block">{lead.last_error}</span>
                    ) : <span className="text-slate-400 text-sm">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="text-slate-400 hover:text-slate-600">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-slate-500 uppercase tracking-widest ${className}`}>
      {children}
    </th>
  );
}

function RejectionBreakdown({
  niche,
  scraped,
  reasons,
}: {
  niche: string;
  scraped: number;
  reasons: Record<string, number>;
}) {
  const sorted = Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);

  // Tailored next-step suggestions based on the dominant rejection reason
  const dominant = sorted[0]?.[0];
  let suggestion: React.ReactNode;
  if (dominant === "has_website") {
    suggestion = (
      <>
        Almost every result already has a real website. Try a less-saturated market:
        a niche with more solo operators (<span className="font-semibold">mobile mechanic, pool cleaning, pressure washing, lawn care, mobile dog grooming</span>)
        OR a smaller suburb (<span className="font-semibold">Round Rock, Pflugerville, Cedar Park, San Marcos</span>).
      </>
    );
  } else if (dominant === "low_rating") {
    suggestion = (
      <>Too many low-rated businesses. Either the city has poor service quality, or you may want to lower MIN_RATING further in <code className="font-mono text-[12px] bg-amber-100 px-1 py-0.5 rounded">web/lib/filters.ts</code>.</>
    );
  } else if (dominant === "few_reviews") {
    suggestion = (
      <>Most results don&apos;t have enough reviews. The market may be very new, or these may be auto-generated dummy listings. Try a different city.</>
    );
  } else if (dominant === "no_phone") {
    suggestion = <>Many results lack a phone — usually means digital-only or dummy listings. Try a different niche/city.</>;
  } else if (dominant === "category_mismatch") {
    suggestion = <>Google&apos;s category strings don&apos;t match your niche query. Try the exact term Google uses (e.g. &quot;Plumber&quot; instead of &quot;plumbing&quot;).</>;
  } else {
    suggestion = <>Try a different niche or city.</>;
  }

  return (
    <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[13px] text-amber-900 leading-relaxed space-y-2">
      <p className="font-bold">
        Scraped {scraped} {niche}s, but every one was filtered out.
      </p>
      <p>The scraper is working — these are the reasons each lead was rejected:</p>
      <ul className="bg-amber-100/50 rounded p-2 space-y-1">
        {sorted.map(([key, count]) => (
          <li key={key} className="flex justify-between font-mono text-[12px]">
            <span>{REJECTION_REASON_LABEL[key] ?? key}</span>
            <span className="font-bold">{count}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px]">
        <span className="font-semibold">Suggestion: </span>
        {suggestion}
      </p>
    </div>
  );
}

function RerunButton({ id }: { id: string }) {
  return (
    <form action={async () => {
      "use server";
      await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/batches/${id}/run`, { method: "POST" });
    }}>
      <button
        type="submit"
        className="bg-brand text-white px-5 py-2 rounded-full font-semibold text-sm hover:opacity-90 flex items-center gap-2"
      >
        <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
        Re-run
      </button>
    </form>
  );
}
