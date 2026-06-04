"use client";

/**
 * TopBar.tsx — fixed 56px top bar: brand mark + current-page breadcrumb on the
 * left; ISO-week spend chip + notifications on the right.
 *
 * Inputs:  costThisWeekUsd (computed in (dashboard)/layout.tsx) + route (usePathname)
 * Outputs: white top strip. The breadcrumb (LeadGen Ops / <page>) orients the
 *          operator — especially on mobile, where the sidebar is hidden.
 * Used by: (dashboard)/layout.tsx
 *
 * Settings + the user avatar now live in the SideNav footer, so they're dropped
 * here to avoid duplication.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { pageTitle } from "@/lib/nav";

// Keep in sync with MONTHLY_CAP in app/(dashboard)/page.tsx.
const MONTHLY_CAP_USD = 50;

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}·W${String(weekNum).padStart(2, "0")}`;
}

export function TopBar({ costThisWeekUsd }: { costThisWeekUsd?: number }) {
  const pathname = usePathname();
  const title = pageTitle(pathname);
  const spend = typeof costThisWeekUsd === "number" ? costThisWeekUsd : undefined;
  const pct = spend === undefined ? 0 : Math.min(1, spend / MONTHLY_CAP_USD);
  const nearCap = pct > 0.75;

  return (
    <header className="bg-surface border-b border-rule fixed top-0 inset-x-0 z-50 flex items-center justify-between h-14 px-6">
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <span className="relative inline-flex items-center justify-center h-6 w-6 rounded bg-ink">
            <span className="font-display font-bold text-canvas text-[14px] leading-none">L</span>
          </span>
          <span className="hidden sm:inline font-display font-semibold text-ink text-[15px] tracking-tight">
            LeadGen Ops
          </span>
        </Link>
        {title && (
          <>
            <span className="text-ink-subtle text-[15px] leading-none flex-shrink-0" aria-hidden>
              /
            </span>
            <span className="font-display font-semibold text-ink text-[15px] truncate">
              {title}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="hidden md:flex flex-col items-end gap-1">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow text-ink-subtle">{isoWeek()}</span>
            <span className="mono-num text-[13px] font-semibold text-ink">
              {spend !== undefined ? `$${spend.toFixed(2)}` : "—"}
            </span>
            <span className="eyebrow text-ink-subtle">/ ${MONTHLY_CAP_USD}</span>
          </div>
          {spend !== undefined && (
            <div className="h-[3px] w-[120px] bg-rule rounded-full overflow-hidden">
              <div
                className={`h-full ${nearCap ? "bg-warning" : "bg-ink"} transition-all`}
                style={{ width: `${Math.max(2, pct * 100)}%` }}
                aria-hidden
              />
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Notifications"
          className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
