/**
 * (dashboard)/layout.tsx — operator dashboard shell.
 *
 * Sums batches.estimated_cost_usd from this ISO week to power the top-bar
 * cost chip. Wraps every dashboard route with the same TopBar + SideNav.
 */

import { TopBar } from "@/components/TopBar";
import { SideNav } from "@/components/SideNav";
import { getDb } from "@/lib/db";

async function getCostThisWeekUsd(): Promise<number | undefined> {
  try {
    // Monday of the current ISO week, in UTC.
    const now = new Date();
    const day = now.getUTCDay() || 7;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
    const { data } = await getDb()
      .from("batches")
      .select("estimated_cost_usd")
      .gte("created_at", monday.toISOString());
    if (!data) return undefined;
    return data.reduce((sum: number, r: { estimated_cost_usd: number | null }) => sum + (r.estimated_cost_usd ?? 0), 0);
  } catch {
    return undefined;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cost = await getCostThisWeekUsd();
  return (
    <div className="min-h-screen bg-surface text-ink">
      <TopBar costThisWeekUsd={cost} />
      <div className="flex pt-12">
        <SideNav />
        <main className="flex-1 md:ml-60 p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
