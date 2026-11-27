/**
 * leads/ScoreChip.tsx — the lead score as a small chip: "82 · Hot", hover for the reasons.
 *
 * Inputs:  a ScoreSummary (lib/leads/lead-score-load.ts) or null
 * Outputs: the chip, or "—" when the lead has no score
 * Used by: components/LeadsTable.tsx, components/BatchLeadsTables.tsx, components/brain/PlanTable.tsx
 *
 * Dumb.
 */
import { cx } from "@/lib/cx";
import { bandLabel, type ScoreBand, type ScoreSummary } from "@/lib/leads/lead-score";

const TONE: Record<ScoreBand, string> = {
  hot: "bg-positive-soft text-positive",
  warm: "bg-warning-soft text-warning",
  cold: "bg-surface-alt text-ink-muted",
};

/** The hover text: why, and what's holding it back. */
export function scoreTitle(s: ScoreSummary): string {
  return [...s.reasons.map((r) => `• ${r}`), s.holding_back ? `Holding it back: ${s.holding_back}` : ""].filter(Boolean).join("\n");
}

export function ScoreChip({ score, className }: { score: ScoreSummary | null | undefined; className?: string }) {
  if (!score) return <span className={cx("text-ink-subtle text-[13px]", className)}>—</span>;
  return (
    <span
      title={scoreTitle(score)}
      className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold whitespace-nowrap", TONE[score.band], className)}
    >
      {score.score} · {bandLabel(score.band)}
    </span>
  );
}
