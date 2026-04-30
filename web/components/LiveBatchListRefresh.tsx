"use client";

/**
 * LiveBatchListRefresh.tsx — when the batches list contains rows in the
 * `running` state, this client component auto-refreshes the page every 5s
 * so the operator doesn't have to manually reload to see status change.
 *
 * Mounts only when the parent server component sees running batches; once
 * they all flip to done/failed, the parent stops rendering this and the
 * polling stops automatically.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 5000;

export function LiveBatchListRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      Live — refreshing every 5s
    </div>
  );
}
