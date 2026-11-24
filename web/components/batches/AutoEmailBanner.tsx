"use client";
/**
 * batches/AutoEmailBanner.tsx — batch page: when this batch's emails start by themselves, with Cancel (24 Nov 2026).
 *
 * Inputs:  the batch's auto_email_state / auto_email_at / auto_email_note / auto_email_campaign_id (migration 068)
 * Outputs: POST /api/batches/:id/auto-email { action: "cancel" }
 * Used by: app/(dashboard)/batches/[id]/page.tsx
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function AutoEmailBanner(p: { batchId: string; state: string | null; at: string | null; note: string | null; campaignId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!p.state) return null;

  async function cancel() {
    if (!window.confirm("Cancel the automatic emails for this batch? You can still use Email this batch by hand.")) return;
    setBusy(true);
    const r = await fetchJson(`/api/batches/${p.batchId}/auto-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success("Cancelled. Nothing will be emailed automatically.");
    router.refresh();
  }

  const tone = p.state === "waiting" ? "border-action/30 bg-action-soft" : p.state === "started" ? "border-positive/30 bg-positive-soft" : "border-rule bg-surface-alt";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[13px] text-ink ${tone}`}>
      <span className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-ink-muted" />
        {p.state === "waiting" && p.at && (
          <span>
            This batch&rsquo;s emails start by themselves around <span className="font-semibold">{new Date(p.at).toLocaleString()}</span> (10 a day, follow-ups off,
            EU / UK out; leads with no email get the contact form).
          </span>
        )}
        {p.state === "started" && <span>Automatic emails started. {p.note}</span>}
        {p.state === "cancelled" && <span>Automatic emails cancelled.</span>}
        {p.state === "skipped" && <span>Automatic emails didn&rsquo;t start: {p.note}</span>}
      </span>
      {p.state === "waiting" && (
        <Button size="sm" variant="secondary" onClick={cancel} loading={busy} disabled={busy}>
          Cancel
        </Button>
      )}
      {p.state === "started" && p.campaignId && (
        <Link href={`/campaigns/${p.campaignId}`} className="text-[12px] text-action hover:underline">
          Open the campaign (pause or stop it there) →
        </Link>
      )}
    </div>
  );
}
