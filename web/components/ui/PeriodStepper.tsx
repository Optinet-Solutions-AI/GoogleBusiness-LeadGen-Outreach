/**
 * ui/PeriodStepper.tsx — ← <label> → navigation for the Status period window,
 * plus a reset link when off the current period. Zero client JS (<Link>s).
 * A null nextHref renders a disabled (non-link) forward arrow — the future is
 * always empty so you can't step past the current period.
 *
 * Inputs:  label, prevHref, nextHref (null = disabled), resetHref + resetLabel.
 * Outputs: an inline stepper control.
 * Used by: app/(dashboard)/status/page.tsx
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ARROW =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rule text-ink-muted hover:text-ink hover:border-rule-strong transition-colors";
const ARROW_OFF =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rule text-ink-subtle/40 cursor-not-allowed";

export function PeriodStepper({
  label,
  prevHref,
  nextHref,
  resetHref,
  resetLabel,
}: {
  label: string;
  prevHref: string;
  nextHref: string | null;
  resetHref?: string | null;
  resetLabel?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Link href={prevHref} aria-label="Previous period" className={ARROW}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Link>
      <span className="mono-num text-[12px] text-ink min-w-[110px] text-center">{label}</span>
      {nextHref ? (
        <Link href={nextHref} aria-label="Next period" className={ARROW}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span aria-hidden className={ARROW_OFF}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </span>
      )}
      {resetHref && resetLabel && (
        <Link href={resetHref} className="text-[12px] text-action hover:underline ml-1">
          {resetLabel}
        </Link>
      )}
    </div>
  );
}
