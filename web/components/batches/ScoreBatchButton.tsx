/**
 * batches/ScoreBatchButton.tsx — "Score this batch": score the leads of a finished batch that have no score yet,
 * after showing how many and what it costs (27 Nov 2026).
 *
 * Inputs:  batchId
 * Outputs: GET /api/batches/:id/lead-score (count + cost, free) → confirm → POST { confirm: true } (Cloud Run)
 * Used by: app/(dashboard)/batches/[id]/page.tsx (finished batches)
 *
 * Dumb. Hidden while the count loads, when every lead is scored, or when scoring isn't available (no 076 / no key).
 */
"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

type Count = { unscored: number; cap: number; est_usd: number };

export function ScoreBatchButton({ batchId }: { batchId: string }) {
  const [count, setCount] = useState<Count | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/batches/${batchId}/lead-score`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => live && j.success && setCount(j.data as Count))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [batchId]);

  if (message) return <span className="text-[12px] text-ink-muted max-w-[260px]">{message}</span>;
  if (!count || !count.unscored || !count.cap) return null;
  const n = Math.min(count.unscored, count.cap);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/lead-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      setMessage(json.success ? "Scoring started. Refresh in a few minutes." : json.error ?? "Couldn't start the scoring.");
    } catch {
      setMessage("Couldn't start the scoring. Try again.");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  if (asking) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px] text-ink">
        Score {n} lead{n === 1 ? "" : "s"}, about ${count.est_usd.toFixed(2)}?
        <button type="button" className="font-semibold text-action hover:underline" onClick={start} disabled={busy}>
          {busy ? "Starting…" : "Yes, score them"}
        </button>
        <button type="button" className="text-ink-subtle hover:text-ink" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      title={`${count.unscored} lead${count.unscored === 1 ? "" : "s"} in this batch have no lead score yet`}
      className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
    >
      <Gauge className="h-4 w-4" />
      Score this batch
    </button>
  );
}
