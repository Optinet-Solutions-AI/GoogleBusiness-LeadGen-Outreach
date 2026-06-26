"use client";

/**
 * CampaignRowActions.tsx — quick Launch + Delete on a campaign list row.
 *
 * Inputs:  id + status + channel
 * Outputs: POST /api/campaigns/[id]/launch (email, non-active) · DELETE
 *          /api/campaigns/[id]; refreshes the list.
 * Used by: (dashboard)/campaigns/page.tsx (inside the clickable CampaignRow).
 *
 * Clicks stopPropagation so they don't trigger the row's navigate-to-detail.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Trash2, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function CampaignRowActions({
  id,
  status,
  channel,
}: {
  id: string;
  status: string;
  channel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"launch" | "delete" | null>(null);

  const canLaunch = channel === "email" && status !== "active";

  async function launch(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Launch this campaign? It enrolls the members and starts sending within caps + the send window. (Tip: send a test from the campaign first.)")) return;
    setBusy("launch");
    const res = await fetchJson<{ enrolled: number; skipped: number }>(`/api/campaigns/${id}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (!res.success) return toast.error(res.error, { title: "Launch failed" });
    toast.success(
      res.data.enrolled > 0
        ? `Launched — ${res.data.enrolled} enrolled${res.data.skipped ? ` (${res.data.skipped} skipped)` : ""}.`
        : "Nothing to enroll — members already active, unverified, or no email.",
    );
    router.refresh();
  }

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this campaign? This removes its membership and stops any active sequences for its leads. This cannot be undone.")) return;
    setBusy("delete");
    const res = await fetchJson<{ deleted: boolean }>(`/api/campaigns/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.success) return toast.error(res.error, { title: "Delete failed" });
    toast.success("Campaign deleted.");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canLaunch && (
        <button
          onClick={launch}
          disabled={busy !== null}
          title="Launch campaign"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-positive hover:bg-positive-soft disabled:opacity-50"
        >
          {busy === "launch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" strokeWidth={2} />}
          Launch
        </button>
      )}
      <button
        onClick={remove}
        disabled={busy !== null}
        title="Delete campaign"
        aria-label="Delete campaign"
        className="rounded p-1.5 text-ink-subtle hover:bg-urgent-soft hover:text-urgent disabled:opacity-50"
      >
        {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </button>
    </div>
  );
}
