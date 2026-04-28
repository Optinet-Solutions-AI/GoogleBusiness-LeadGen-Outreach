/**
 * (dashboard)/batches/[id]/page.tsx — Batch detail.
 *
 * 4 stat cards, a stage funnel, and a filterable lead table for this batch.
 */

import Link from "next/link";
import { RefreshCw, MoreVertical } from "lucide-react";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { StatusChip } from "@/components/StatusChip";
import { StageChip } from "@/components/StageChip";
import { StageFunnel } from "@/components/StageFunnel";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();
  const { data: batch } = await db.from("batches").select("*").eq("id", params.id).single();
  if (!batch) notFound();

  const { data: leads = [] } = await db
    .from("leads")
    .select("id,business_name,address,stage,email,demo_url,last_error,created_at")
    .eq("batch_id", params.id)
    .order("created_at", { ascending: false });

  const counts: Record<string, number> = {};
  for (const lead of leads ?? []) counts[lead.stage] = (counts[lead.stage] ?? 0) + 1;

  const total = (leads ?? []).length;
  const qualified = total; // all `leads` rows already passed the qualifying filter
  const deployed = (counts.deployed ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) +
                   (counts.meeting_booked ?? 0) + (counts.meeting_done ?? 0) +
                   (counts.improved ?? 0) + (counts.handed_over ?? 0) + (counts.closed_won ?? 0);
  const replies = counts.replied ?? 0;

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total leads" value={total} hint={`${batch.limit ?? 0} requested`} />
        <StatCard label="Qualified" value={qualified} emphasis hint={total > 0 ? `${Math.round((qualified / total) * 100)}% kept` : undefined} />
        <StatCard label="Deployed" value={deployed} emphasis hint={total > 0 ? `${Math.round((deployed / total) * 100)}% live` : undefined} />
        <StatCard label="Replies" value={replies} hint={deployed > 0 ? `${((replies / deployed) * 100).toFixed(1)}% rate` : undefined} hintTone="positive" />
      </div>

      <StageFunnel counts={counts} />

      <section>
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-4">
          <div className="flex space-x-6">
            <button className="text-sm font-semibold text-brand border-b-2 border-brand pb-2 px-1">
              All leads ({total})
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
              {(leads ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">
                    No leads scraped yet.
                  </td>
                </tr>
              )}
              {(leads ?? []).map((lead) => (
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
