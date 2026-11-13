"use client";

/**
 * SequenceCard.tsx — right-rail panel: the lead's follow-up emails (Send email follow-ups or the classic
 * screenshot sequence started from Email selected / a campaign).
 *
 * Shows the status (email N of M sent, next send, sender mailbox, screenshot thumbnail) and the controls: Stop,
 * Re-capture screenshot. Starting follow-ups happens in the Send email window (13 Nov 2026), so there is no
 * Enroll button here; the page only shows this card once the lead has follow-up history.
 * Used by: (dashboard)/leads/[id]/page.tsx
 *
 * POSTs to /api/leads/[id]/sequence { action }. stop is instant; recapture hands off to Cloud Run (Chromium).
 * Dumb component — display + fire actions only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Square, Camera } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { variantFor, maxStepForVariant, usesNoDemoCopy } from "@/lib/email/sequence-templates";
import type { CallSegment } from "@/lib/segment";

/** Future-aware "when's the next step" label (relativeTime only does the past). */
function dueLabel(iso: string | null): string {
  if (!iso) return "soon";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

interface SeqLead {
  id: string;
  email: string | null;
  demo_url: string | null;
  screenshot_url: string | null;
  seq_status: string | null;
  seq_step: number | null;
  seq_next_step_at: string | null;
  seq_sender_email: string | null;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-action-soft text-action",
  stopped: "bg-surface-alt text-ink-muted",
  completed: "bg-positive-soft text-positive",
  none: "bg-surface-alt text-ink-muted",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  stopped: "Stopped",
  completed: "Completed",
  none: "Not enrolled",
};

export function SequenceCard({ lead, segment, planSteps }: { lead: SeqLead; segment: CallSegment; planSteps?: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "stop" | "recapture">(null);

  const status = lead.seq_status ?? "none";
  const step = lead.seq_step ?? 0;
  const isActive = status === "active";
  // The services variant (has_website → AI services) needs no demo and runs 2 steps. build/improve with a
  // built demo run the 4-step screenshot ladder; without one they get the 2-step "want a free sample?"
  // version (same rule as the scheduler tick).
  const variant = variantFor(segment);
  const noDemo = usesNoDemoCopy(variant, !lead.demo_url);
  // Follow-ups written in the Send email window carry their own length (first email + 1 or 2 follow-ups).
  const manual = !!planSteps;
  const maxSteps = planSteps || maxStepForVariant(variant, noDemo);

  async function act(action: "stop" | "recapture") {
    setBusy(action);
    const res = await fetchJson(`/api/leads/${lead.id}/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (!res.success) {
      toast.error(res.error, { title: "Sequence" });
      return;
    }
    const msg =
      action === "stop"
          ? "Sequence stopped."
          : "Re-capturing screenshot…";
    toast.success(msg);
    router.refresh();
  }

  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow">{manual ? "Follow-up emails" : "Email sequence"}</p>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.14em] font-mono ${STATUS_TONE[status] ?? STATUS_TONE.none}`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-3">
        {Array.from({ length: maxSteps }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-action" : "bg-rule"}`}
            title={`Step ${n}`}
          />
        ))}
      </div>
      <p className="text-[12px] text-ink-muted">
        {isActive ? (
          <>
            Email {step} of {maxSteps} sent · next {dueLabel(lead.seq_next_step_at)}. Stops by itself if they reply.
          </>
        ) : status === "completed" ? (
          `All ${maxSteps} emails sent — no reply.`
        ) : status === "stopped" ? (
          "Stopped (reply / opt-out / bounce / stopped by hand)."
        ) : (
          "No follow-ups scheduled. Add them in Send email."
        )}
      </p>
      {lead.seq_sender_email && (
        <p className="text-[11px] text-ink-subtle mt-1 font-mono">from {lead.seq_sender_email}</p>
      )}

      {/* Screenshot thumbnail */}
      {lead.screenshot_url && !manual && (
        <a href={lead.screenshot_url} target="_blank" rel="noreferrer" className="block mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lead.screenshot_url}
            alt="Demo screenshot"
            className="w-full rounded border border-rule"
          />
        </a>
      )}

      {/* Actions */}
      <div className="mt-4 space-y-2">
        {isActive && (
          <Button variant="soft-danger" className="w-full" onClick={() => act("stop")} loading={busy === "stop"}>
            {busy !== "stop" && <Square strokeWidth={2.5} />} {manual ? "Stop follow-ups" : "Stop sequence"}
          </Button>
        )}

        {lead.demo_url && !manual && (
          <Button variant="soft" className="w-full" onClick={() => act("recapture")} loading={busy === "recapture"}>
            {busy !== "recapture" && <Camera strokeWidth={2.5} />} Re-capture screenshot
          </Button>
        )}
      </div>

    </section>
  );
}
