"use client";

/**
 * VerifyLeadsButton.tsx — Header action: POST /api/verify to trigger the
 * Cloud Run email-verification job, then toast the result.
 *
 * Inputs:  none (no props required)
 * Outputs: toast feedback; does not mutate local state
 * Used by: app/(dashboard)/leads/page.tsx (PageHeader actions)
 */

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function VerifyLeadsButton() {
  const [busy, setBusy] = useState(false);

  async function verify() {
    if (busy) return;
    setBusy(true);
    const res = await fetchJson("/api/verify", { method: "POST" });
    setBusy(false);

    if (!res.success) {
      // 503 = Cloud Run not configured; surface the helpful message directly
      if (res.error && res.error.includes("Cloud Run")) {
        toast.info(res.error);
      } else {
        toast.error(res.error ?? "Verification trigger failed.", { title: "Error" });
      }
      return;
    }
    toast.success("Verification started — refresh in a bit.");
  }

  return (
    <Button variant="secondary" onClick={verify} loading={busy}>
      {!busy && <ShieldCheck strokeWidth={2} />}
      {busy ? "Starting…" : "Verify emails"}
    </Button>
  );
}
