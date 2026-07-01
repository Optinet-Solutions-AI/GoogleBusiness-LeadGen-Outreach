"use client";

/**
 * BatchProgressPoller.tsx — while a batch is `running`, poll the detail
 * endpoint every 3s and refresh the page when it transitions to `done` or
 * `failed`.
 *
 * The endpoint runs the server-side watchdog (lib/pipeline/reap-stuck.ts) on
 * every poll, so a batch whose scrape process died is auto-flipped to `failed`
 * within a few minutes — no client-side guessing, and no "retry" button here
 * that could fire a second (paid) scrape on top of one that's still running.
 * When the status flips, we refresh and the page's own `failed`/`done` banner
 * takes over (the failed banner has the safe Re-run action).
 *
 * Mounted by the batch detail page only when batch.status === 'running'.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";

const POLL_MS = 3000;
// Past this, scraping is just taking a while (big batch / site crawling). We
// show a calmer "still working" note — NOT an alarm — because the server
// watchdog will auto-reset the row if the process actually died.
const SLOW_AFTER_MS = 90 * 1000;

export function BatchProgressPoller({
  batchId,
  startedAt,
}: {
  batchId: string;
  startedAt: string; // batch.updated_at ISO string when it flipped to running
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSlow = elapsed * 1000 >= SLOW_AFTER_MS;

  useEffect(() => {
    let cancelled = false;
    const start = new Date(startedAt).getTime();

    async function tick() {
      if (cancelled) return;
      // bump elapsed counter for the badge
      setElapsed(Math.floor((Date.now() - start) / 1000));

      const res = await fetchJson<{ batch: { status: string } }>(`/api/batches/${batchId}`);
      if (cancelled) return;
      if (res.success && res.data?.batch?.status && res.data.batch.status !== "running") {
        // Status flipped (done, or auto-reset to failed by the watchdog) —
        // refresh the server component for fresh data.
        router.refresh();
      }
    }

    tickRef.current = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [batchId, startedAt, router]);

  return (
    <div className="rounded-lg bg-action-soft border border-action/30 px-4 py-3 text-[13px] text-action leading-relaxed flex items-center gap-3">
      <Loader2 className="h-5 w-5 flex-none animate-spin" />
      <div className="flex-1">
        <span className="font-semibold">Scraping in progress…</span>{" "}
        <span className="text-action font-mono text-[12px]">{formatElapsed(elapsed)} elapsed</span>
        {isSlow ? (
          <span className="ml-2 text-[12px] text-action">
            — larger scrapes can take a few minutes. This updates automatically; if the job died it
            will reset itself shortly, no action needed.
          </span>
        ) : (
          <span className="ml-2 text-[12px] text-action">— Refreshing every 3s. You can leave this page.</span>
        )}
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
