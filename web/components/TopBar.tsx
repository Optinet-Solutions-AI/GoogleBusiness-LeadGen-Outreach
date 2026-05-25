"use client";

/**
 * TopBar.tsx — fixed 56px top bar with brand mark + spend chip + utility icons.
 *
 * Inputs:  costThisWeekUsd (computed in (dashboard)/layout.tsx)
 * Outputs: white top strip with logo mark on the left and on the right:
 *          an ISO-week spend chip with a thin indigo capacity bar showing
 *          spend / $50 monthly cap, then bell + settings + avatar.
 * Used by: (dashboard)/layout.tsx
 */

import Link from "next/link";
import { Bell, Settings, User } from "lucide-react";

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
  const spend = typeof costThisWeekUsd === "number" ? costThisWeekUsd : undefined;
  const pct = spend === undefined ? 0 : Math.min(1, spend / MONTHLY_CAP_USD);
  const nearCap = pct > 0.75;

  return (
    <header className="bg-surface border-b border-rule fixed top-0 inset-x-0 z-50 flex items-center justify-between h-14 px-6">
      <Link href="/" className="flex items-center gap-2.5 group">
        <span className="relative inline-flex items-center justify-center h-6 w-6 rounded bg-ink">
          <span className="font-display font-bold text-canvas text-[14px] leading-none">L</span>
        </span>
        <span className="font-display font-semibold text-ink text-[15px] tracking-tight">
          LeadGen Ops
        </span>
      </Link>

      <div className="flex items-center gap-4">
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
                className={`h-full ${nearCap ? "bg-warning" : "bg-action"} transition-all`}
                style={{ width: `${Math.max(2, pct * 100)}%` }}
                aria-hidden
              />
            </div>
          )}
        </div>

        <button
          aria-label="Notifications"
          className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          aria-label="Settings"
          className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="h-7 w-7 rounded-full bg-surface-alt border border-rule flex items-center justify-center text-ink-muted">
          <User className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
      </div>
    </header>
  );
}
