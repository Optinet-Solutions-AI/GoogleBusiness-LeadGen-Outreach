/**
 * ReverifyButton.tsx — one-click re-verify trigger for a single lead's email.
 *
 * Inputs:  leadId (UUID string)
 * Outputs: POST /api/verify/sync with { leadIds: [leadId] }; refreshes the page
 *          on success so the verification card reflects the new result.
 * Used by: (dashboard)/leads/[id]/page.tsx → EmailVerificationCard
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function ReverifyButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetchJson<{ results: Record<string, string> }>("/api/verify/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: [leadId] }),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Verify failed" });
      return;
    }
    toast.success(`Verified: ${res.data.results[leadId] ?? "done"}.`);
    router.refresh();
  }

  return (
    <Button variant="secondary" size="sm" onClick={run} loading={busy}>
      Re-verify email
    </Button>
  );
}
