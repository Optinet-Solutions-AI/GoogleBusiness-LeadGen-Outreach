/**
 * MailboxPauseButton.tsx — Pause / Resume one sending mailbox (27 Nov 2026, workflow watch_mailbox_health.md).
 *
 * Inputs:  id, paused (current state)
 * Outputs: PATCH /api/email-accounts/:id { action: "pause" | "resume" } → router.refresh(); the refusal as plain text
 * Used by: app/(dashboard)/email-accounts/page.tsx
 *
 * Dumb. Resume is the only way a mailbox the app paused comes back.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

export function MailboxPauseButton({ id, paused }: { id: string; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/email-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: paused ? "resume" : "pause" }),
      });
      const json = await res.json();
      if (!json.success) setMessage(json.error ?? "Couldn't change it.");
      else router.refresh();
    } catch {
      setMessage("Couldn't change it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={paused ? "Start sending from this mailbox again" : "Stop sending from this mailbox until you press Resume"}
        className={
          paused
            ? "inline-flex items-center gap-1 rounded-md bg-action px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90"
            : "inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:text-ink hover:bg-surface-alt"
        }
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {busy ? "…" : paused ? "Resume" : "Pause"}
      </button>
      {message && <span className="text-[11px] text-urgent max-w-[200px] text-right">{message}</span>}
    </span>
  );
}
