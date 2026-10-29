"use client";

/**
 * VersionStrip.tsx — v1…vN chips with state, click to view a version, and its notes.
 *
 * Inputs:  versions, reviews, shown version number
 * Outputs: onSelect(version number) — pure UI, no network
 * Used by: components/clients/CreativeView.tsx
 */

import type { ReviewRow, VersionRow } from "@/lib/creatives/creatives";

const STATE_TONE: Record<string, string> = {
  approved: "text-positive",
  draft: "text-ink-muted",
  changes_requested: "text-warning",
  rejected: "text-danger",
  superseded: "text-ink-subtle",
};

export function VersionStrip({
  versions,
  reviews,
  shown,
  onSelect,
}: {
  versions: VersionRow[];
  reviews: ReviewRow[];
  shown: number;
  onSelect: (version: number) => void;
}) {
  const asc = [...versions].sort((a, b) => a.version - b.version);
  const current = asc.find((v) => v.version === shown);
  const notes = current ? reviews.filter((r) => r.version_id === current.id && r.note) : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
        {asc.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.version === shown}
            onClick={() => onSelect(v.version)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11.5px] ${
              v.version === shown ? "border-ink bg-surface-alt" : "border-rule bg-surface hover:border-ink"
            }`}
          >
            <span className="font-medium text-ink">v{v.version}</span>
            <span className={`capitalize ${STATE_TONE[v.state] ?? "text-ink-muted"}`}>{v.state.replace("_", " ")}</span>
          </button>
        ))}
      </div>
      {(current?.note || notes.length > 0) && (
        <ul className="text-[11.5px] text-ink-muted space-y-0.5">
          {current?.note && <li>Version note: {current.note}</li>}
          {notes.map((r) => (
            <li key={r.id}>
              {r.action.replace("_", " ")}: {r.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
