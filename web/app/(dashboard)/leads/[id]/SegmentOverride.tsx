/**
 * SegmentOverride.tsx — Client component for manually overriding a lead's call segment.
 *
 * Inputs:  leadId, current segment, offer_locked flag, segment_reviewed_at stamp
 * Outputs: PATCH /api/leads/:id → triggers router.refresh() on success
 * Used by: (dashboard)/leads/[id]/page.tsx (IdentityCard)
 *
 * Two distinct concepts: `locked` is a CONTROL flag (pipeline won't re-route);
 * `reviewedAt` is an audit stamp (a human looked at this) that survives clearing
 * the lock. "Clear lock" hands routing back to the pipeline but keeps the badge.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SEGMENTS = [
  { value: "no_website", label: "No website → Build" },
  { value: "old_website", label: "Old/weak website → Improve" },
  { value: "has_website", label: "Healthy website → Discovery" },
] as const;

export function SegmentOverride({
  leadId,
  segment,
  locked,
  reviewedAt,
}: {
  leadId: string;
  segment: string | null;
  locked: boolean;
  reviewedAt?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(segment ?? "has_website");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "update failed");
      router.refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="text-[13px] border border-rule rounded px-2 py-1 bg-surface"
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          patch({ call_segment: e.target.value });
        }}
      >
        {SEGMENTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {locked ? (
        <button
          className="text-[11px] text-ink-subtle underline disabled:opacity-50"
          disabled={busy}
          onClick={() => patch({ offer_locked: false })}
          title="Locked: the pipeline won't re-route this lead. Click to unlock and let it re-classify (keeps the reviewed mark)."
        >
          🔒 Locked · unlock
        </button>
      ) : (
        reviewedAt && (
          <span
            className="text-[11px] text-ink-subtle"
            title={`Reviewed by an operator on ${new Date(reviewedAt).toLocaleString()}. Routing is back with the pipeline.`}
          >
            ✓ Reviewed · auto-routing
          </span>
        )
      )}
      {err && <span className="text-[11px] text-urgent">{err}</span>}
    </div>
  );
}
