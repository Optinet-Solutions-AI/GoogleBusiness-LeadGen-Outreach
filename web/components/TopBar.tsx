"use client";

/**
 * TopBar.tsx — fixed 48px top app bar with brand + week/cost chips.
 *
 * Cost chip is a placeholder for now — wire it to a /api/status/today endpoint
 * (or compute from batches.estimated_cost_usd sum) when the backend has data.
 */

import Link from "next/link";
import { Bell, Settings, User } from "lucide-react";

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function TopBar({ costThisWeekUsd }: { costThisWeekUsd?: number }) {
  return (
    <header className="bg-white border-b border-slate-200 fixed top-0 inset-x-0 z-50 flex justify-between items-center h-12 px-4">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-5 w-5 rounded bg-brand" />
          <span className="text-[15px] font-bold tracking-tight text-brand">LeadGen Ops</span>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden lg:flex flex-col items-end mr-2">
          <span className="font-mono text-[12px] font-bold text-brand">
            {typeof costThisWeekUsd === "number" ? `$${costThisWeekUsd.toFixed(2)}` : "—"}
          </span>
          <span className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider">
            {isoWeek()}
          </span>
        </div>
        <button className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <button className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
          <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <div className="h-7 w-7 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-500">
          <User className="h-4 w-4" />
        </div>
      </div>
    </header>
  );
}
