"use client";

/**
 * MailboxRemoveButton.tsx — per-mailbox "Remove" control on the Email accounts page.
 *
 * Inputs:  { id, email }
 * Outputs: DELETE /api/email-accounts/:id → toast + refresh on success
 * Used by: app/(dashboard)/email-accounts/page.tsx
 *
 * Confirms first (removal stops sends from this mailbox and drops it from the list).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function MailboxRemoveButton({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !confirm(
        `Remove ${email}?\n\nIt will stop sending and disappear from this list. Any sequence pinned to it pauses until you pick another mailbox. Thread history is kept.`,
      )
    )
      return;
    setBusy(true);
    const res = await fetchJson(`/api/email-accounts/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Remove failed" });
      return;
    }
    toast.success(`Removed ${email}.`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      title={`Remove ${email}`}
      aria-label={`Remove ${email}`}
      className="text-ink-subtle hover:text-urgent transition-colors disabled:opacity-50 p-1.5 rounded hover:bg-urgent-soft"
    >
      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
