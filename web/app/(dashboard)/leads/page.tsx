/**
 * (dashboard)/leads/page.tsx — Leads list (across all batches).
 *
 * Table of every lead, filterable by ?stage=<value>. Useful for triaging
 * `needs_email`, browsing `replied`, or finding handed-over customers.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StageChip } from "@/components/StageChip";
import { safeDb } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  business_name: string;
  city: string | null;
  category: string | null;
  email: string | null;
  stage: string;
  demo_url: string | null;
  custom_domain: string | null;
  updated_at: string;
}

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

async function getLeads(stage: string | undefined): Promise<Lead[]> {
  return safeDb(
    async (db) => {
      let q = db
        .from("leads")
        .select("id,business_name,address,category,email,stage,demo_url,custom_domain,updated_at")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (stage) q = q.eq("stage", stage);
      const { data } = await q;
      return ((data ?? []) as Array<Lead & { address: string | null }>).map((l) => ({
        ...l,
        city: cityFromAddress(l.address ?? null),
      }));
    },
    [] as Lead[],
  );
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

interface PageProps {
  searchParams: { stage?: string };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const activeStage = searchParams.stage;
  const leads = await getLeads(activeStage);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-headline-sm text-slate-900 tracking-tight">Leads</h1>
          <p className="text-body-sm text-slate-500">
            {leads.length} {activeStage ? `at stage "${activeStage}"` : "across all batches"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
        {FILTER_PILLS.map((p) => {
          const active = (activeStage ?? "") === (p.stage ?? "");
          return (
            <Link
              key={p.label}
              href={p.stage ? `/leads?stage=${p.stage}` : "/leads"}
              className={[
                "px-4 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-semibold transition-colors flex-none",
                active
                  ? "bg-brand text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              ].join(" ")}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {leads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg py-16 text-center">
          <p className="text-slate-500 text-sm">
            {activeStage
              ? `No leads at stage "${activeStage}".`
              : "No leads yet. Run a batch from the Batches page to get started."}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>Business / city</Th>
                <Th>Stage</Th>
                <Th>Email</Th>
                <Th>Live URL</Th>
                <Th>Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${lead.id}`} className="block">
                      <div className="text-body-base font-semibold text-slate-800 truncate">{lead.business_name}</div>
                      <div className="text-[11px] text-slate-400">
                        {lead.city ?? lead.category ?? "—"}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5"><StageChip stage={lead.stage} /></td>
                  <td className="px-4 py-2.5 text-body-sm font-mono text-slate-600 truncate max-w-[200px]">
                    {lead.email ?? <span className="italic text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.custom_domain ? (
                      <a
                        href={`https://${lead.custom_domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-body-sm text-emerald-700 hover:underline truncate block max-w-[220px] font-mono"
                      >
                        {lead.custom_domain}
                      </a>
                    ) : lead.demo_url ? (
                      <a
                        href={lead.demo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-body-sm text-brand hover:underline truncate block max-w-[220px]"
                      >
                        {lead.demo_url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-400 font-mono">{relativeTime(lead.updated_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/leads/${lead.id}`} className="text-slate-400 hover:text-slate-700">
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
