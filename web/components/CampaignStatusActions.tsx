"use client";

/**
 * CampaignStatusActions.tsx — Pause / Activate / Mark done buttons for a campaign.
 *
 * Inputs:  campaign id + current status (props)
 * Outputs: PATCH /api/campaigns/[id] with { status } then router.refresh()
 * Used by: (dashboard)/campaigns/[id]/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  status: string;
}

type CampaignStatus = "active" | "paused" | "done";

interface Action {
  label: string;
  next: CampaignStatus;
  cls: string;
}

/** Determine which actions are available for a given status. */
function actionsFor(status: string): Action[] {
  switch (status) {
    case "active":
      return [
        {
          label: "Pause",
          next: "paused",
          cls: "bg-warning-soft text-warning border border-warning/40 hover:bg-warning/15",
        },
        {
          label: "Mark done",
          next: "done",
          cls: "bg-surface-alt text-ink-muted border border-rule hover:bg-surface-alt/80",
        },
      ];
    case "paused":
      return [
        {
          label: "Activate",
          next: "active",
          cls: "bg-positive-soft text-positive border border-positive/40 hover:bg-positive/15",
        },
        {
          label: "Mark done",
          next: "done",
          cls: "bg-surface-alt text-ink-muted border border-rule hover:bg-surface-alt/80",
        },
      ];
    case "draft":
    case "building":
      return [
        {
          label: "Activate",
          next: "active",
          cls: "bg-positive-soft text-positive border border-positive/40 hover:bg-positive/15",
        },
      ];
    case "done":
      return [
        {
          label: "Re-activate",
          next: "active",
          cls: "bg-positive-soft text-positive border border-positive/40 hover:bg-positive/15",
        },
      ];
    default:
      return [];
  }
}

export function CampaignStatusActions({ id, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<CampaignStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status);

  async function handleClick(next: CampaignStatus) {
    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setError(json.error ?? "Update failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setPending(null);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.next}
            disabled={pending !== null}
            onClick={() => handleClick(a.next)}
            className={[
              "px-3 py-2 rounded text-[12px] font-semibold tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              a.cls,
            ].join(" ")}
          >
            {pending === a.next ? "Saving…" : a.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-[11px] text-urgent">{error}</p>
      )}
    </div>
  );
}
