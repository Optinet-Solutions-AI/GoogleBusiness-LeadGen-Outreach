"use client";

/**
 * SyncRepliesButton.tsx — Inbox action: pull inbound replies from connected
 * mailboxes (POST /api/email/sync), toast the result, and refresh the list.
 *
 * Used by: app/(dashboard)/inbox/page.tsx (header action).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface SyncResult {
  fetched: number;
  stored: number;
  matched: number;
  accounts: { email: string; error?: string }[];
}

export function SyncRepliesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    if (busy) return;
    setBusy(true);
    const res = await fetchJson<SyncResult>("/api/email/sync", { method: "POST" });
    setBusy(false);

    if (!res.success) {
      toast.error(res.error, { title: "Sync failed" });
      return;
    }
    const { fetched, stored, accounts } = res.data;
    if (accounts.length === 0) {
      toast.info("No mailbox connected yet — connect one on Email accounts.");
    } else if (stored > 0) {
      toast.success(`${stored} new repl${stored === 1 ? "y" : "ies"} pulled in.`);
    } else {
      toast.info(fetched > 0 ? "No new replies matched a lead." : "No new mail.");
    }
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={sync} loading={busy}>
      {!busy && <RefreshCw strokeWidth={2} />}
      {busy ? "Syncing…" : "Sync replies"}
    </Button>
  );
}
