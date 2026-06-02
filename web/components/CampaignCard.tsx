/**
 * CampaignCard.tsx — Presentational card for a single call campaign.
 *
 * Inputs:  campaign row from call_campaigns + aggregated lead counts
 * Outputs: clickable card linking to /campaigns/[id]
 * Used by: (dashboard)/campaigns/page.tsx
 */

import Link from "next/link";
import { StatusChip } from "@/components/StatusChip";

interface Campaign {
  id: string;
  name: string;
  source: string;
  segment: string | null;
  country_code: string | null;
  category: string | null;
  batch_id: string | null;
  target_count: number | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  timezone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CampaignCounts {
  total: number;
  called: number;
  interested: number;
}

interface Props {
  campaign: Campaign;
  counts: CampaignCounts;
}

/** Map integer day numbers (1=Mon … 7=Sun) to short labels. */
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function daysLabel(call_days: number[] | null): string {
  if (!call_days || call_days.length === 0) return "No days set";
  const sorted = [...call_days].sort((a, b) => a - b);
  // Detect contiguous Mon–Fri
  if (sorted.length === 5 && sorted.join(",") === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  // Compact: list abbreviated names
  return sorted.map((d) => DAY_NAMES[(d - 1) % 7] ?? `${d}`).join(", ");
}

const SEGMENT_CHIPS: Record<string, { label: string; cls: string }> = {
  no_website:  { label: "Build",   cls: "bg-positive-soft text-positive border-positive/30" },
  old_website: { label: "Improve", cls: "bg-warning-soft text-warning border-warning/30" },
  has_website: { label: "Menu",    cls: "bg-action-soft text-action border-action/30" },
};

export function CampaignCard({ campaign, counts }: Props) {
  const seg = campaign.segment ? (SEGMENT_CHIPS[campaign.segment] ?? null) : null;
  const schedule = [
    daysLabel(campaign.call_days),
    campaign.call_start_hour !== null && campaign.call_end_hour !== null
      ? `${campaign.call_start_hour}:00–${campaign.call_end_hour}:00`
      : null,
    campaign.timezone || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="block bg-surface border border-rule rounded-lg p-4 hover:bg-surface-alt transition-colors group"
    >
      {/* Top row: name + segment chip */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[15px] font-semibold text-ink leading-snug group-hover:text-action transition-colors">
          {campaign.name}
        </span>
        {seg && (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border leading-tight flex-none ${seg.cls}`}
          >
            {seg.label}
          </span>
        )}
      </div>

      {/* Source + status row */}
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border leading-tight bg-surface-alt text-ink-muted border-rule capitalize">
          {campaign.source ?? "app"}
        </span>
        <StatusChip status={campaign.status} />
      </div>

      {/* Schedule summary */}
      <p className="text-[12px] text-ink-subtle mb-3 font-mono">{schedule}</p>

      {/* Counts */}
      <p className="text-[12px] text-ink-muted">
        <span className="mono-num font-semibold text-ink">{counts.total}</span>
        {" leads · "}
        <span className="mono-num font-semibold text-ink">{counts.called}</span>
        {" called · "}
        <span className="mono-num font-semibold text-ink">{counts.interested}</span>
        {" interested"}
      </p>
    </Link>
  );
}
