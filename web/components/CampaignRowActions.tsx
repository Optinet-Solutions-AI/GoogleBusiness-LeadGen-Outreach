"use client";

/**
 * CampaignRowActions.tsx — quick Launch / Pause / Resume + Delete on a list row.
 *
 * - Launch (draft/done, email): opens the test-then-confirm LaunchModal.
 * - Pause (active): PATCH status=paused (cascades to members' sequence).
 * - Resume (paused): PATCH status=active.
 * - Delete: DELETE /api/campaigns/[id] (stops sequences, removes membership).
 *
 * Clicks stopPropagation so they don't trigger the row's open-detail navigation.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Trash2, Loader2, Pause, Play } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { LaunchModal } from "@/components/inbox/LaunchModal";

export function CampaignRowActions({
  id,
  name,
  status,
  channel,
}: {
  id: string;
  name: string;
  status: string;
  channel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"status" | "delete" | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);

  const isEmail = channel === "email";

  async function setStatus(next: "paused" | "active", label: string, e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("status");
    const res = await fetchJson(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(null);
    if (!res.success) return toast.error(res.error, { title: "Update failed" });
    toast.success(label);
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
    <>
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {isEmail && status === "active" && (
          <button
            onClick={(e) => setStatus("paused", "Campaign paused.", e)}
            disabled={busy !== null}
            title="Pause campaign"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning-soft disabled:opacity-50"
          >
            {busy === "status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" strokeWidth={2} />}
            Pause
          </button>
        )}
        {isEmail && status === "paused" && (
          <button
            onClick={(e) => setStatus("active", "Campaign resumed.", e)}
            disabled={busy !== null}
            title="Resume campaign"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-positive hover:bg-positive-soft disabled:opacity-50"
          >
            {busy === "status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" strokeWidth={2} />}
            Resume
          </button>
        )}
        {isEmail && status !== "active" && status !== "paused" && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowLaunch(true); }}
            disabled={busy !== null}
            title="Launch campaign"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-positive hover:bg-positive-soft disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} /> Launch
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

      {showLaunch && (
        <LaunchModal
          campaignId={id}
          campaignName={name}
          onClose={() => setShowLaunch(false)}
          onLaunched={() => { setShowLaunch(false); router.refresh(); }}
        />
      )}
    </>
  );
}
