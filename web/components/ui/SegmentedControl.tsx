/**
 * ui/SegmentedControl.tsx — a small grouped toggle of <Link>s (zero client JS).
 * Each option is a URL; the active one is filled. Used for the Status period
 * switch (Week / Month / Year).
 *
 * Inputs:  options ({ value, label, href }), active value.
 * Outputs: a bordered inline segmented control.
 * Used by: app/(dashboard)/status/page.tsx
 */
import Link from "next/link";
import { cx } from "@/lib/cx";

export function SegmentedControl({
  options,
  active,
}: {
  options: { value: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-rule bg-surface p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          aria-current={o.value === active ? "page" : undefined}
          className={cx(
            "px-3 py-1 rounded text-[12px] font-semibold transition-colors",
            o.value === active ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
