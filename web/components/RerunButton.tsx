"use client";

/**
 * RerunButton.tsx — kicks off (or re-runs) the scrape for a batch.
 *
 * Lives on the batch detail header. Calls POST /api/batches/:id/run via the
 * client `fetchJson` helper so any error (Cloud Run not configured, OIDC
 * missing, etc.) is surfaced as an alert instead of crashing the page.
 *
 * Why a client component: the previous server-action version used fetch()
 * with a relative URL, which Node's fetch rejects, throwing a server-side
 * exception that the user saw as "Application error: Digest…". A regular
 * browser fetch handles relative URLs natively and lets us actually see
 * the error envelope coming back from the route handler.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";

export function RerunButton({ id }: { id: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function trigger() {
    if (running) return;
    setRunning(true);
    const res = await fetchJson(`/api/batches/${id}/run`, { method: "POST" });
    setRunning(false);
    if (!res.success) {
      toast.error(res.error, { title: "Re-run failed" });
      return;
    }
    toast.success("Re-run started — scraping now.");
    router.refresh();
  }

  return (
    <Button type="button" onClick={trigger} loading={running}>
      {!running && <RefreshCw strokeWidth={2.5} />}
      {running ? "Starting…" : "Re-run"}
    </Button>
  );
}
