/**
 * MetricCard.tsx — a single metric on the mission-control home page.
 *
 * Inputs:  eyebrow label, value (number | formatted string), optional delta,
 *          optional caption, optional href (clickable card), optional prefix.
 * Outputs: light cream card with eyebrow + huge italic-serif value + small
 *          delta or caption. Clickable cards route + lift on hover.
 * Used by: app/(dashboard)/page.tsx (mission control grid)
 *
 * The display number is the centerpiece. Italic serif at display sizes,
 * tabular numerics so digits align across cards. Delta uses small mono with
 * a tiny up/down glyph — never the colored green/red SaaS treatment.
 */

import Link from "next/link";
import { ArrowUp, ArrowDown, ArrowUpRight } from "lucide-react";

interface DeltaProps {
  value: number | string;
  direction?: "up" | "down" | "flat";
  vs?: string;
  tone?: "positive" | "neutral" | "warning";
}

interface Props {
  eyebrow: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  caption?: string;
  delta?: DeltaProps;
  href?: string;
  /** Optional larger size — used for the dominant top-row metrics. */
  size?: "md" | "lg";
}

export function MetricCard({
  eyebrow,
  value,
  prefix,
  suffix,
  caption,
  delta,
  href,
  size = "md",
}: Props) {
  const valueSize = size === "lg" ? "text-[80px]" : "text-[64px]";
  const content = (
    <article className="relative bg-surface rounded-xl border border-rule border-t-[3px] border-t-accent p-6 flex flex-col h-full group shadow-elev transition-shadow hover:shadow-elev-lg">
      <header className="flex items-start justify-between gap-2">
        <span className="eyebrow">{eyebrow}</span>
        {href && (
          <ArrowUpRight
            className="h-3.5 w-3.5 text-ink-subtle group-hover:text-accent group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all flex-shrink-0"
            strokeWidth={1.75}
          />
        )}
      </header>

      <div className="flex-1 flex items-end mt-2">
        <div className="flex items-end gap-1">
          {prefix && (
            <span
              className="editorial-number text-ink/55 mb-1"
              style={{ fontSize: size === "lg" ? "32px" : "26px" }}
            >
              {prefix}
            </span>
          )}
          <span className={`editorial-number text-ink ${valueSize}`}>{value}</span>
          {suffix && (
            <span
              className="editorial-number text-ink/55 mb-1.5"
              style={{ fontSize: size === "lg" ? "32px" : "26px" }}
            >
              {suffix}
            </span>
          )}
        </div>
      </div>

      <footer className="mt-3 min-h-[18px] flex items-center gap-2">
        {delta && <DeltaPill {...delta} />}
        {caption && <span className="text-[11.5px] text-ink-muted leading-tight">{caption}</span>}
      </footer>
    </article>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block h-full hover:-translate-y-0.5 transition-transform">
      {content}
    </Link>
  );
}

function DeltaPill({ value, direction = "flat", vs, tone = "neutral" }: DeltaProps) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : null;
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "warning"
        ? "text-warning"
        : "text-ink-muted";

  return (
    <span className={`mono-num text-[11px] inline-flex items-center gap-0.5 ${toneClass}`}>
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.5} />}
      <span className="font-semibold">{value}</span>
      {vs && <span className="text-ink-subtle ml-1">{vs}</span>}
    </span>
  );
}
