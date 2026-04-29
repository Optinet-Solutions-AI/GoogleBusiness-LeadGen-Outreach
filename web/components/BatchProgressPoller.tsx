"use client";

/**
 * BatchProgressPoller.tsx — when a batch is in `running` state, poll the
 * detail endpoint every 3s and refresh the page when it transitions to
 * `done` or `failed`. Also detects "stuck" — running for >3 min likely
 * means Vercel killed the function — and surfaces a retry CTA.
 *
 * Mounted by the batch detail page only when batch.status === 'running'.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";

const POLL_MS = 3000;
const STUCK_AFTER_MS = 3 * 60 * 1000; // 3 minutes

export function BatchProgressPoller({
  batchId,
  startedAt,
}: {
  batchId: string;
  startedAt: string; // batch.updated_at ISO string when it flipped to running
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isStuck = elapsed * 1000 >= STUCK_AFTER_MS;

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
        // Status flipped — refresh the server component for fresh data
        router.refresh();
      }
    }

    tickRef.current = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [batchId, startedAt, router]);

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    const res = await fetchJson(`/api/batches/${batchId}/run`, { method: "POST" });
    setRetrying(false);
    if (!res.success) {
      setRetryError(res.error);
      return;
    }
    router.refresh();
  }

  if (isStuck) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-[13px] text-amber-900 leading-relaxed flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 flex-none mt-0.5" />
        <div className="flex-1">
          <p className="font-bold mb-1">This batch may be stuck.</p>
          <p className="mb-2">
            It&apos;s been <span className="font-mono font-semibold">{formatElapsed(elapsed)}</span> in the running state.
            On Vercel, scrapes that take longer than ~60s get cut off mid-flight; the database row
            gets stuck at <span className="font-mono">running</span> because the orchestrator never reached
            its final write. Retry, or use the CLI for big batches.
          </p>
          {retryError && <p className="text-rose-700 text-[12px] mb-2 font-mono">{retryError}</p>}
          <button
            onClick={retry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[12px] font-semibold px-4 py-1.5 rounded-full disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry scrape"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-[13px] text-blue-800 leading-relaxed flex items-center gap-3">
      <Loader2 className="h-5 w-5 flex-none animate-spin" />
      <div className="flex-1">
        <span className="font-semibold">Scraping in progress…</span>{" "}
        <span className="text-blue-600 font-mono text-[12px]">{formatElapsed(elapsed)} elapsed</span>
        <span className="ml-2 text-[12px] text-blue-700">— Refreshing every 3s. You can leave this page.</span>
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
