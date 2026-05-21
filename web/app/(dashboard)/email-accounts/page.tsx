/**
 * (dashboard)/email-accounts/page.tsx — Connected sending mailboxes.
 *
 * Lists rows from `email_accounts`. CTA opens ConnectBluehostModal which
 * POSTs /api/email-accounts/bluehost.
 */

import { Mail, ShieldAlert, ShieldCheck, Pause } from "lucide-react";
import { safeDb } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { EmailAccountsActions } from "@/components/EmailAccountsActions";

export const dynamic = "force-dynamic";

interface EmailAccount {
  id: string;
  email: string;
  from_name: string | null;
  provider: string | null;
  status: "active" | "paused" | "error";
  daily_cap: number | null;
  hourly_cap: number | null;
  warmup_enabled: boolean;
  warmup_target_cap: number;
  created_at: string;
}

export default async function EmailAccountsPage() {
  const list = await safeDb<EmailAccount[]>(
    async (db) => {
      const { data } = await db
        .from("email_accounts")
        .select("id,email,from_name,provider,status,daily_cap,hourly_cap,warmup_enabled,warmup_target_cap,created_at")
        .order("created_at", { ascending: false });
      return (data ?? []) as EmailAccount[];
    },
    [],
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-headline-sm text-slate-900 tracking-tight">Email Accounts</h1>
          <p className="text-body-sm text-slate-500">
            {list.length} {list.length === 1 ? "mailbox" : "mailboxes"} connected for outbound
          </p>
        </div>
        <EmailAccountsActions />
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg py-16 text-center">
          <Mail className="h-10 w-10 text-slate-300 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-slate-700 text-sm font-medium mb-1">No mailboxes connected yet</p>
          <p className="text-slate-500 text-[13px]">
            Connect a Bluehost / Titan mailbox to send through your own domain.
          </p>
        </div>
      ) : (
        <ul className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
          {list.map((acc) => (
            <li key={acc.id} className="flex items-center gap-4 p-4">
              <StatusIcon status={acc.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-slate-900 truncate">{acc.email}</span>
                  <span className="text-[12px] text-slate-400 font-mono flex-none">
                    added {relativeTime(acc.created_at)}
                  </span>
                </div>
                <p className="text-sm text-slate-500 truncate mt-0.5">
                  {acc.provider ?? "SMTP"}
                  {acc.from_name && acc.from_name !== acc.email ? ` · "${acc.from_name}"` : ""}
                  {acc.warmup_enabled ? ` · warming up to ${acc.warmup_target_cap}/day` : ""}
                </p>
              </div>
              <StatusPill status={acc.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: EmailAccount["status"] }) {
  const cls = "h-9 w-9 rounded-full flex items-center justify-center flex-none";
  if (status === "active")
    return (
      <div className={`${cls} bg-emerald-100`}>
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
      </div>
    );
  if (status === "paused")
    return (
      <div className={`${cls} bg-amber-100`}>
        <Pause className="h-4 w-4 text-amber-700" />
      </div>
    );
  return (
    <div className={`${cls} bg-rose-100`}>
      <ShieldAlert className="h-4 w-4 text-rose-700" />
    </div>
  );
}

function StatusPill({ status }: { status: EmailAccount["status"] }) {
  const styles: Record<EmailAccount["status"], string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span
      className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}
