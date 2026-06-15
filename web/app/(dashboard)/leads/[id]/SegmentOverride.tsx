/**
 * SegmentOverride.tsx — Client component for manually overriding a lead's call segment.
 *
 * Inputs:  leadId, current segment, offer_locked flag
 * Outputs: PATCH /api/leads/:id → triggers router.refresh() on success
 * Used by: (dashboard)/leads/[id]/page.tsx (IdentityCard)
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
}: {
  leadId: string;
  segment: string | null;
  locked: boolean;
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
      {locked && (
        <button
          className="text-[11px] text-ink-subtle underline disabled:opacity-50"
          disabled={busy}
          onClick={() => patch({ offer_locked: false })}
          title="Clear the manual lock and let the pipeline re-route"
        >
          Manual · clear lock
        </button>
      )}
      {err && <span className="text-[11px] text-urgent">{err}</span>}
    </div>
  );
}
