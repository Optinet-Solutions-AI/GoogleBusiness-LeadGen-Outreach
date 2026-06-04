"use client";
/**
 * LaunchCampaignButton.tsx — send an email campaign's pending members (capped).
 *
 * Inputs:  campaign id (string)
 * Outputs: POST /api/campaigns/:id/launch → toast result + router.refresh()
 * Used by: (dashboard)/campaigns/[id]/page.tsx — email campaigns only
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function LaunchCampaignButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function launch() {
    setBusy(true);
    const res = await fetchJson<{ sent: number; held: number; skipped: number }>(`/api/campaigns/${id}/launch`, { method: "POST" });
    setBusy(false);
    if (!res.success) { toast.error(res.error, { title: "Launch failed" }); return; }
    const { sent, held } = res.data;
    toast.success(sent > 0 ? `Sent ${sent}${held ? ` · ${held} held for the cap` : ""}.` : held ? "Nothing sent — daily cap reached." : "Nothing pending to send.");
    router.refresh();
  }
  return (
    <Button variant="primary" onClick={launch} loading={busy}>
      {!busy && <Send strokeWidth={2} />} Launch send
    </Button>
  );
}
