/**
 * StageChip.tsx — color-coded chip for a `lead.stage` value.
 *
 * Used on every page that renders a lead. Color map follows the Stitch
 * design's "quiet semantic" rule: tinted bg + saturated text for the
 * status, brand color reserved for primary actions only.
 */

const STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scraped:        { bg: "bg-slate-100",   text: "text-slate-700",   label: "Scraped" },
  enriched:       { bg: "bg-slate-100",   text: "text-slate-700",   label: "Enriched" },
  generated:      { bg: "bg-blue-100",    text: "text-blue-700",    label: "Generated" },
  deployed:       { bg: "bg-cyan-100",    text: "text-cyan-700",    label: "Deployed" },
  outreached:     { bg: "bg-indigo-100",  text: "text-indigo-700",  label: "Outreached" },
  needs_email:    { bg: "bg-amber-100",   text: "text-amber-700",   label: "Needs email" },
  replied:        { bg: "bg-emerald-100", text: "text-emerald-700", label: "Replied" },
  meeting_booked: { bg: "bg-violet-100",  text: "text-violet-700",  label: "Meeting booked" },
  meeting_done:   { bg: "bg-violet-100",  text: "text-violet-700",  label: "Meeting done" },
  improved:       { bg: "bg-cyan-100",    text: "text-cyan-700",    label: "Improved" },
  handed_over:    { bg: "bg-emerald-100", text: "text-emerald-700", label: "Handed over" },
  closed_won:     { bg: "bg-emerald-600", text: "text-white",       label: "Closed won" },
  closed_lost:    { bg: "bg-rose-100",    text: "text-rose-700",    label: "Closed lost" },
  dead:           { bg: "bg-slate-200",   text: "text-slate-500",   label: "Dead" },
};

export function StageChip({ stage, className = "" }: { stage: string; className?: string }) {
  const s = STAGE_STYLES[stage] ?? { bg: "bg-slate-100", text: "text-slate-700", label: stage };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text} ${className}`}
    >
      {s.label}
    </span>
  );
}
