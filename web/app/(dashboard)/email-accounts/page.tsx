/**
 * (dashboard)/email-accounts/page.tsx — Connected sending mailboxes.
 *
 * Lists rows from `email_accounts`. CTA opens ConnectMailboxModal which
 * POSTs /api/email-accounts/bluehost.
 */

import { Mail, ShieldAlert, ShieldCheck, Pause } from "lucide-react";
import { safeDb } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { EmailAccountsActions } from "@/components/EmailAccountsActions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

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
      <PageHeader
        eyebrow="Sender mailboxes"
        title="Email accounts"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{list.length}</span>{" "}
            {list.length === 1 ? "mailbox" : "mailboxes"} connected for outbound
          </>
        }
        actions={<EmailAccountsActions />}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No mailboxes connected yet"
          description="Connect a Bluehost / Titan mailbox to send through your own domain. We test SMTP + IMAP before saving."
        />
      ) : (
        <ul className="bg-surface border border-rule rounded-lg divide-y divide-rule overflow-hidden">
          {list.map((acc) => (
            <li key={acc.id} className="flex items-center gap-4 p-4 hover:bg-surface-alt transition-colors">
              <StatusIcon status={acc.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold text-ink truncate">{acc.email}</span>
                  <span className="mono-num text-[11px] text-ink-subtle flex-none">
                    added {relativeTime(acc.created_at)}
                  </span>
                </div>
                <p className="text-[13px] text-ink-muted truncate mt-0.5">
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
  const cls = "h-9 w-9 rounded flex items-center justify-center flex-none";
  if (status === "active")
    return (
      <div className={`${cls} bg-positive-soft`}>
        <ShieldCheck className="h-4 w-4 text-positive" strokeWidth={1.75} />
      </div>
    );
  if (status === "paused")
    return (
      <div className={`${cls} bg-warning-soft`}>
        <Pause className="h-4 w-4 text-warning" strokeWidth={1.75} />
      </div>
    );
  return (
    <div className={`${cls} bg-urgent-soft`}>
      <ShieldAlert className="h-4 w-4 text-urgent" strokeWidth={1.75} />
    </div>
  );
}

function StatusPill({ status }: { status: EmailAccount["status"] }) {
  const styles: Record<EmailAccount["status"], string> = {
    active: "bg-positive-soft text-positive border-positive/30",
    paused: "bg-warning-soft text-warning border-warning/30",
    error:  "bg-urgent-soft text-urgent border-urgent/30",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-[0.14em] font-mono ${styles[status]}`}
    >
      {status}
    </span>
  );
}
