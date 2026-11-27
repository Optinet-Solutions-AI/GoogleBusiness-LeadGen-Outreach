/**
 * inbox/ReplyAiBox.tsx — above the Inbox reply box: how the AI read their latest reply, and Draft with AI / Redraft
 * (27 Nov 2026, workflow handle_replies_with_ai.md).
 *
 * Inputs:  leadId, the latest reply's ai_* fields (state, category, summary, error, when)
 * Outputs: POST /api/leads/:id/reply-draft → router.refresh() (the new draft fills the reply box); refusals as text
 * Used by: app/(dashboard)/inbox/[id]/page.tsx
 *
 * Dumb. The AI only drafts: the person sends with the reply box below.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ReplyCategoryChip } from "@/components/inbox/ReplyCategoryChip";
import { relativeTime } from "@/lib/format";

export interface ReplyAi {
  state: string | null;
  category: string | null;
  summary: string | null;
  error: string | null;
  at: string | null;
}

export function ReplyAiBox({ leadId, ai }: { leadId: string; ai: ReplyAi }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/reply-draft`, { method: "POST" });
      const json = await res.json();
      if (!json.success) setMessage(json.error ?? "Couldn't draft this one.");
      else router.refresh();
    } catch {
      setMessage("Couldn't draft this one. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const stop = ai.category === "stop";
  return (
    <div className="mt-5 rounded-lg border border-rule bg-surface-alt px-3 py-2.5 text-[12.5px] text-ink">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 flex-none text-action" strokeWidth={2} aria-hidden />
          {ai.category ? (
            <>
              <span className="text-ink-muted">AI read this as</span>
              <ReplyCategoryChip category={ai.category} />
              {ai.summary && <span className="truncate">{ai.summary}</span>}
            </>
          ) : ai.state === "pending" ? (
            <span className="text-ink-muted">The AI is reading this reply and writing a draft (within a few minutes)…</span>
          ) : ai.state === "failed" ? (
            <span className="text-ink-muted">The AI couldn&apos;t draft this one{ai.error ? `: ${ai.error}` : ""}.</span>
          ) : (
            <span className="text-ink-muted">No AI draft yet.</span>
          )}
        </div>
        {!stop && (
          <button type="button" onClick={draft} disabled={busy} className="text-[12px] font-semibold text-action hover:underline disabled:opacity-60">
            {busy ? "Drafting…" : ai.category ? "Redraft" : "Draft with AI"}
          </button>
        )}
      </div>
      {stop && <p className="mt-1.5 text-ink-muted">They asked not to be contacted: marked unsubscribed. No answer needed.</p>}
      {ai.category && !stop && (
        <p className="mt-1 text-[11px] text-ink-subtle">
          The draft is in the box below: check it, edit it, then send. Drafted {relativeTime(ai.at)}. The AI never sends anything.
        </p>
      )}
      {message && <p className="mt-1.5 text-[12px] text-urgent">{message}</p>}
    </div>
  );
}
