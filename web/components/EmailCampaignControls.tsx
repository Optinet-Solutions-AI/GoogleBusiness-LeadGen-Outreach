"use client";

/**
 * EmailCampaignControls.tsx — launch / pause panel for an email campaign detail.
 *
 * Not yet live  → "Launch campaign" opens the test-then-confirm LaunchModal.
 * Live (active) → shows it's sending + a Pause button.
 * Paused        → shows paused + a Resume button.
 *
 * Inputs:  campaignId, status, mailboxes, firstSendLabel
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx (email campaigns only).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Mail, Pause, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { LaunchModal } from "@/components/inbox/LaunchModal";

interface Mailbox {
  email: string;
  from_name: string | null;
}

export function EmailCampaignControls({
  campaignId,
  campaignName,
  status,
  mailboxes,
  firstSendLabel,
}: {
  campaignId: string;
  campaignName?: string;
  status: string;
  mailboxes: Mailbox[];
  firstSendLabel?: string | null;
}) {
  const router = useRouter();
  const [showLaunch, setShowLaunch] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasMailbox = mailboxes.length > 0;
  const isActive = status === "active";
  const isPaused = status === "paused";

  async function setStatus(next: "paused" | "active", label: string) {
    setBusy(true);
    const res = await fetchJson(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (!res.success) return toast.error(res.error, { title: "Update failed" });
    toast.success(label);
    router.refresh();
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
        <p className="eyebrow text-ink-muted">Email sending</p>
      </div>

      {!hasMailbox ? (
        <p className="text-[12.5px] text-ink-muted">
          No mailbox connected. Connect one on{" "}
          <a href="/email-accounts" className="underline underline-offset-2 hover:text-ink">Email accounts</a> to send.
        </p>
      ) : isActive ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink">
            <span className="inline-flex items-center gap-1.5 font-semibold text-positive">
              <span className="h-2 w-2 rounded-full bg-positive" /> Live
            </span>{" "}
            <span className="text-ink-muted">sending within caps + the send window, rotating across your mailboxes.</span>
          </p>
          <Button variant="secondary" onClick={() => setStatus("paused", "Campaign paused.")} loading={busy}>
            {!busy && <Pause strokeWidth={2} />} Pause
          </Button>
        </div>
      ) : isPaused ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink">
            <span className="font-semibold text-warning">Paused.</span>{" "}
            <span className="text-ink-muted">No emails go out until you resume.</span>
          </p>
          <Button variant="primary" onClick={() => setStatus("active", "Campaign resumed.")} loading={busy}>
            {!busy ? <Play strokeWidth={2} /> : <Loader2 className="h-4 w-4 animate-spin" />} Resume
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">
            Launch sends a test to you first, then enrolls members on your confirmation. Nothing reaches a lead until
            you click <span className="font-semibold text-ink">All good</span>.
          </p>
          {firstSendLabel && (
            <div className="rounded-md bg-action-soft/40 border border-action/20 px-3 py-2 text-[12px] text-ink">
              <span className="font-semibold text-action">First emails go out around</span> {firstSendLabel}.{" "}
              <span className="text-ink-muted">Follow-ups about 4 days apart.</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setShowLaunch(true)}>
              <Send strokeWidth={2} /> Launch campaign
            </Button>
          </div>
        </>
      )}

      {showLaunch && (
        <LaunchModal
          campaignId={campaignId}
          campaignName={campaignName}
          onClose={() => setShowLaunch(false)}
          onLaunched={() => { setShowLaunch(false); router.refresh(); }}
        />
      )}
    </section>
  );
}
