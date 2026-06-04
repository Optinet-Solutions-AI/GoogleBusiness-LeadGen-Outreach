/**
 * ui/PageHeader.tsx — the one page-header pattern across the dashboard.
 *
 * Inputs:  eyebrow (small caps kicker), title, optional subtitle/meta, optional
 *          actions node (right-aligned), optional children (a row below — filter
 *          pills, tabs, etc.).
 * Outputs: a consistent header block so every page reads the same way instead of
 *          each rolling its own markup.
 * Used by: dashboard list/detail pages. Server-compatible — pass a client action
 *          component (e.g. <NewBatchButton/>) as `actions`.
 */

import * as React from "react";
import { cx } from "@/lib/cx";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-7", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2 text-ink-subtle">{eyebrow}</p>}
          <h1 className="editorial-head text-ink text-[30px] md:text-[34px] leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-ink-muted mt-2.5">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}
