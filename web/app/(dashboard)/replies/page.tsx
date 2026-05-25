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
      <header className="flex items-end justify-between mb-6 gap-4">
        <div>
          <p className="eyebrow mb-2">Inbox</p>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
            Replies
          </h1>
          <p className="text-[13px] text-ink-muted mt-2">
            <span className="mono-num text-ink font-semibold">{list.length}</span>{" "}
            {list.length === 1 ? "lead" : "leads"} waiting on triage
          </p>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg py-16 text-center">
          <Inbox className="h-10 w-10 text-ink-subtle mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-ink text-sm font-medium mb-1">No replies yet</p>
          <p className="text-ink-muted text-[12.5px]">Patience pays — they land here the moment they reply.</p>
        </div>
      ) : (
        <ul className="bg-surface border border-rule rounded-lg divide-y divide-rule overflow-hidden">
          {list.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/leads/${lead.id}`}
                className="flex items-center gap-4 p-4 hover:bg-surface-alt transition-colors group"
              >
                <div className="h-9 w-9 rounded bg-positive-soft flex items-center justify-center flex-none">
                  <MessageSquareText className="h-4 w-4 text-positive" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-semibold text-ink truncate">
                      {lead.business_name}
                    </span>
                    <span className="mono-num text-[11px] text-ink-subtle flex-none">
                      {relativeTime(lead.updated_at)}
                    </span>
                  </div>
                  <p className="text-[13px] text-ink-muted truncate mt-0.5">
                    {lead.notes
                      ? lead.notes.split("\n").pop()
                      : lead.email
                      ? `Replied via ${lead.email}`
                      : "Awaiting triage"}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 text-ink-subtle flex-none group-hover:text-ink group-hover:translate-x-0.5 transition-all"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
