/**
 * StageChip.tsx — color-coded chip for a `lead.stage` value.
 *
 * Inputs:  stage string (matches `leads.stage` enum)
 * Outputs: small uppercase mono pill, restricted to the four design-system
 *          stage tones (positive / warning / urgent / neutral) plus an
 *          action-soft variant for in-flight stages. NO ad-hoc Tailwind
 *          color palettes — every chip belongs to one of these buckets.
 * Used by: every page that renders a lead row.
 */

type Tone = "positive" | "warning" | "urgent" | "action" | "neutral";

const STAGE_STYLES: Record<string, { tone: Tone; label: string }> = {
  scraped:        { tone: "neutral",  label: "Scraped" },
  enriched:       { tone: "neutral",  label: "Enriched" },
  generated:      { tone: "action",   label: "Generated" },
  deployed:       { tone: "action",   label: "Deployed" },
  outreached:     { tone: "action",   label: "Outreached" },
  needs_email:    { tone: "warning",  label: "Needs email" },
  replied:        { tone: "urgent",   label: "Replied" },
  meeting_booked: { tone: "warning",  label: "Meeting booked" },
  meeting_done:   { tone: "warning",  label: "Meeting done" },
  improved:       { tone: "action",   label: "Improved" },
  handed_over:    { tone: "positive", label: "Handed over" },
  closed_won:     { tone: "positive", label: "Closed won" },
  closed_lost:    { tone: "urgent",   label: "Closed lost" },
  dead:           { tone: "neutral",  label: "Dead" },
};

const TONE_CLASS: Record<Tone, string> = {
  positive: "bg-positive-soft text-positive",
  warning:  "bg-warning-soft text-warning",
  urgent:   "bg-urgent-soft text-urgent",
  action:   "bg-action-soft text-action",
  neutral:  "bg-surface-alt text-ink-muted",
};

export function StageChip({ stage, className = "" }: { stage: string; className?: string }) {
  const s = STAGE_STYLES[stage] ?? { tone: "neutral" as Tone, label: stage };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.14em] font-mono ${TONE_CLASS[s.tone]} ${className}`}
    >
      {s.label}
    </span>
  );
}
