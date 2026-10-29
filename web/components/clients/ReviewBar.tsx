"use client";

/**
 * ReviewBar.tsx — Approve / Request changes (with note) / Reject for a version.
 *
 * Inputs:  clientId, creativeId, version (state, renders, grounding), blockedReason (extra disable reason, e.g. unsaved edits)
 * Outputs: POST /api/clients/:id/creatives/:cid/review, toasts, router.refresh()
 * Used by: components/clients/CreativeView.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { canApprove, type ReviewAction } from "@/lib/creatives/state";
import type { VersionRow } from "@/lib/creatives/creatives";

export function ReviewBar({
  clientId,
  creativeId,
  version,
  blockedReason,
}: {
  clientId: string;
  creativeId: string;
  version: Pick<VersionRow, "state" | "renders" | "grounding" | "version">;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const verdict = canApprove(version);
  const reason = blockedReason ?? (verdict.ok ? undefined : verdict.reason);

  async function act(action: ReviewAction, n?: string) {
    setBusy(true);
    try {
      const res = await fetchJson<{ version: unknown }>(`/api/clients/${clientId}/creatives/${creativeId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: n?.trim() || undefined }),
      });
      if (!res.success) return toast.error(res.error);
      toast.success(action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Changes requested");
      setAsking(false);
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (version.state !== "draft") {
    return (
      <p className="text-[12px] text-ink-muted capitalize">
        v{version.version} is {version.state.replace("_", " ")}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="positive" loading={busy} disabled={!!reason} title={reason} onClick={() => act("approve")}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking((a) => !a)}>
          Request changes
        </Button>
        <Button
          size="sm"
          variant="soft-danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Reject this version?")) void act("reject");
          }}
        >
          Reject
        </Button>
      </div>
      {reason && <p className="text-[11.5px] text-ink-muted">Cannot approve: {reason}</p>}
      {asking && (
        <div className="space-y-1.5">
          <textarea
            className="w-full border border-rule rounded px-2 py-1.5 text-[12.5px] bg-surface text-ink outline-none focus:border-ink"
            rows={2}
            placeholder="What should change?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Change request note"
          />
          <Button size="sm" loading={busy} disabled={!note.trim()} onClick={() => act("request_changes", note)}>
            Send request
          </Button>
        </div>
      )}
    </div>
  );
}
