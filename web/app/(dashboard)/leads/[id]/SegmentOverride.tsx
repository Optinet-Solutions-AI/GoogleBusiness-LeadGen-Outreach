/**
 * SegmentOverride.tsx — Client component for manually overriding a lead's call segment.
 *
 * Inputs:  leadId, current segment, offer_locked flag, segment_reviewed_at stamp
 * Outputs: PATCH /api/leads/:id → triggers router.refresh() on success
 * Used by: (dashboard)/leads/[id]/page.tsx (WebsiteVerdictCard)
 *
 * Plain-language labels (15 Nov 2026): what their website is like → what we offer, and which email Send email
 * picks first. `segment` is the lead's effective segment (the override, else what the audit decided).
 *
 * Two distinct concepts: `locked` is a CONTROL flag (pipeline won't re-route);
 * `reviewedAt` is an audit stamp (a human looked at this) that survives clearing
 * the lock. "Clear lock" hands routing back to the pipeline but keeps the badge.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SEGMENTS = [
  { value: "no_website", label: "No website → offer a new website", hint: "Send email starts with the \"New website\" email. Build website makes a demo." },
  { value: "old_website", label: "Old or weak website → offer a redesign", hint: "Send email starts with the \"Website redesign\" email. Build website makes a modern version." },
  { value: "has_website", label: "Good website → offer AI services", hint: "We don't pitch a website. Send email starts with the AI voice agent email (or pick AI booking / SEO)." },
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
  const [value, setValue] = useState(segment ?? "no_website");
  const current = SEGMENTS.find((s) => s.value === value);
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
    <div className="space-y-1.5 pt-1">
      <label className="block text-[11px] font-semibold text-ink-muted" htmlFor={`segment-${leadId}`}>
        Their website is… (change it if the audit got it wrong)
      </label>
      <select
        id={`segment-${leadId}`}
        className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-md bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:bg-surface-alt"
        value={value}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value;
          // Flipping to Improve kicks off a (free) re-enrich that crawls the old
          // website for its images + logo. Confirm so an accidental dropdown
          // change doesn't trigger it. Other segments switch instantly.
          if (
            next === "old_website" &&
            value !== "old_website" &&
            !confirm(
              "Mark their website as old or weak? We'll also read their current site for its photos and logo (free) so a redesign demo can use them. Click Build website afterwards to make it.",
            )
          ) {
            return;
          }
          setValue(next);
          patch({ call_segment: next });
        }}
      >
        {SEGMENTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {current && <p className="text-[11px] text-ink-subtle">{current.hint}</p>}
      <div className="flex items-center gap-2">
      {locked ? (
        <button
          className="text-[11px] text-ink-subtle underline disabled:opacity-50"
          disabled={busy}
          onClick={() => patch({ offer_locked: false })}
          title="You set this by hand, so the system won't change it. Click to let the website audit decide again."
        >
          Set by you · let the audit decide
        </button>
      ) : (
        reviewedAt && (
          <span
            className="text-[11px] text-ink-subtle"
            title={`Checked by a person on ${new Date(reviewedAt).toLocaleString()}. The website audit decides again now.`}
          >
            ✓ Checked · the audit decides
          </span>
        )
      )}
      {err && <span className="text-[11px] text-urgent">{err}</span>}
      </div>
    </div>
  );
}
