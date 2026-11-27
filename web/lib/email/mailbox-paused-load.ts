/**
 * email/mailbox-paused-load.ts — the mailboxes the app paused on its own (auto-pause, 27 Nov 2026).
 *
 * Inputs:  email_accounts (status 'paused', paused_by 'auto'; migration 077)
 * Outputs: [{ email, reason, at }] — [] on any error or before 077 (the warning strip then stays hidden)
 * Used by: components/MailboxPausedBanner.tsx (every dashboard page)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";

export async function loadAutoPaused(): Promise<{ email: string; reason: string; at: string }[]> {
  try {
    const { data, error } = await getDb()
      .from("email_accounts")
      .select("email,paused_reason,paused_at")
      .eq("status", "paused")
      .eq("paused_by", "auto")
      .order("paused_at", { ascending: false });
    if (error || !data) return [];
    return (data as { email: string; paused_reason: string | null; paused_at: string | null }[]).map((r) => ({
      email: r.email,
      reason: r.paused_reason ?? "too many bounces or complaints",
      at: r.paused_at ?? "",
    }));
  } catch {
    return [];
  }
}
