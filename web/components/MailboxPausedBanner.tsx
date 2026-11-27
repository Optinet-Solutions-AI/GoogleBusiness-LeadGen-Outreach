/**
 * MailboxPausedBanner.tsx — the warning strip on every dashboard page while the app has paused a sending mailbox
 * (auto-pause, 27 Nov 2026, workflow watch_mailbox_health.md).
 *
 * Inputs:  lib/email/mailbox-paused-load.ts (mailboxes with paused_by 'auto')
 * Outputs: one strip listing each paused mailbox and why, linking to Email accounts; nothing when none
 * Used by: app/(dashboard)/layout.tsx (next to the Test mode banner)
 *
 * Read on every request (like TestModeBanner). A mailbox you paused yourself isn't listed.
 */
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { MailWarning } from "lucide-react";
import { loadAutoPaused } from "@/lib/email/mailbox-paused-load";

export async function MailboxPausedBanner() {
  noStore();
  const paused = await loadAutoPaused().catch(() => []);
  if (!paused.length) return null;
  return (
    <div className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-[13px] text-ink" role="alert">
      <div className="mx-auto flex max-w-6xl items-start gap-2">
        <MailWarning className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={2} aria-hidden />
        <div className="space-y-0.5">
          {paused.map((p) => (
            <p key={p.email}>
              <span className="font-semibold">Sending is paused for {p.email}</span> ({p.reason}).
            </p>
          ))}
          <p className="text-ink-muted">
            Its emails wait. Check the list, then press Resume on{" "}
            <Link href="/email-accounts" className="font-semibold text-action hover:underline">
              Email accounts
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
