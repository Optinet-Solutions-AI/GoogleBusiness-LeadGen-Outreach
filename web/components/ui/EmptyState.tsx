/**
 * ui/EmptyState.tsx — consistent "nothing here yet" block.
 *
 * Inputs:  icon (lucide component), title, optional description + action node.
 * Outputs: a centered card with an icon chip, helpful copy, and an optional CTA.
 * Used by: list pages with no rows (campaigns, leads, inbox, etc.).
 *
 * Server-compatible (no hooks) — pass a client <Button> as `action` when needed.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/cx";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "card flex flex-col items-center text-center px-6 py-14",
        className,
      )}
    >
      {Icon && (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-alt text-ink-subtle mb-4">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <h3 className="editorial-head text-ink text-[16px] mb-1.5">{title}</h3>
      {description && (
        <p className="text-[13px] text-ink-muted max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
