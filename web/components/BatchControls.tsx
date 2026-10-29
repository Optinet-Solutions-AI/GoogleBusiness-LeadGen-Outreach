"use client";

/**
 * BatchControls.tsx — Pause / Resume / Cancel buttons on a batch's detail header.
 *
 * Inputs:  id, status, stopRequested (batches.stop_requested)
 * Outputs: POST /api/batches/:id/control; on Resume also POST /api/batches/:id/run; router.refresh()
 * Used by: app/(dashboard)/batches/[id]/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";

type Action = "pause" | "resume" | "cancel";

export function BatchControls({
  id,
  status,
  stopRequested,
}: {
  id: string;
  status: string;
  stopRequested: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const stopping = status === "running" && (stopRequested === "pause" || stopRequested === "cancel");

  async function act(action: Action) {
    if (busy) return;
    if (action === "cancel" && !confirm("Cancel this batch? Leads found so far are kept; it can't be resumed.")) return;
    setBusy(action);
    const res = await fetchJson<{ status: string; run: boolean }>(`/api/batches/${id}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.success) {
      setBusy(null);
      toast.error(res.error, { title: "Couldn't update the batch" });
      return;
    }
    if (res.data.run) {
      const run = await fetchJson(`/api/batches/${id}/run`, { method: "POST" });
      if (!run.success) toast.error(run.error, { title: "Resumed, but the run didn't start" });
      else toast.success("Resumed.");
    } else if (res.data.status === "running") {
      toast.success(action === "pause" ? "Pausing — it stops after the scrape returns." : "Cancelling — stopping within a few seconds.");
    } else {
      toast.success(res.data.status === "paused" ? "Paused." : "Cancelled.");
    }
    setBusy(null);
    router.refresh();
  }

  if (stopping) {
    return (
      <span className="text-[12px] text-warning font-medium">
        {stopRequested === "pause" ? "Pausing…" : "Cancelling…"}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {(status === "queued" || status === "running") && (
        <Button type="button" variant="secondary" onClick={() => act("pause")} loading={busy === "pause"}>
          {busy !== "pause" && <Pause strokeWidth={2.5} />}
          Pause
        </Button>
      )}
      {status === "paused" && (
        <Button type="button" onClick={() => act("resume")} loading={busy === "resume"}>
          {busy !== "resume" && <Play strokeWidth={2.5} />}
          Resume
        </Button>
      )}
      {(status === "queued" || status === "running" || status === "paused") && (
        <Button type="button" variant="danger" onClick={() => act("cancel")} loading={busy === "cancel"}>
          {busy !== "cancel" && <X strokeWidth={2.5} />}
          Cancel
        </Button>
      )}
    </div>
  );
}
