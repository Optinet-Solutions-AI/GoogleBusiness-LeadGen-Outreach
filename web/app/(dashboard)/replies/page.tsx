/**
 * (dashboard)/replies/page.tsx — Reply inbox.
 *
 * Lists every lead at stage='replied'. Click row → /leads/[id] for triage.
 */

import Link from "next/link";
import { ChevronRight, MessageSquareText, Inbox } from "lucide-react";
import { safeDb } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  business_name: string;
  email: string | null;
  demo_url: string | null;
  notes: string | null;
  updated_at: string;
}

export default async function RepliesPage() {
  const list = await safeDb<Lead[]>(
    async (db) => {
      const { data } = await db
        .from("leads")
        .select("id,business_name,email,demo_url,notes,updated_at")
        .eq("stage", "replied")
        .order("updated_at", { ascending: false });
      return (data ?? []) as Lead[];
    },
    [],
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-headline-sm text-slate-900 tracking-tight">Replies</h1>
          <p className="text-body-sm text-slate-500">
            {list.length} {list.length === 1 ? "lead" : "leads"} waiting on triage
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg py-16 text-center">
          <Inbox className="h-10 w-10 text-slate-300 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-slate-500 text-sm">No replies yet — patience pays.</p>
        </div>
      ) : (
        <ul className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
          {list.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/leads/${lead.id}`}
                className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center flex-none">
                  <MessageSquareText className="h-4 w-4 text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-slate-900 truncate">{lead.business_name}</span>
                    <span className="text-[12px] text-slate-400 font-mono flex-none">{relativeTime(lead.updated_at)}</span>
                  </div>
                  <p className="text-sm text-slate-500 truncate mt-0.5">
                    {lead.notes ? lead.notes.split("\n").pop() : lead.email ? `Replied via ${lead.email}` : "Awaiting triage"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 flex-none" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
