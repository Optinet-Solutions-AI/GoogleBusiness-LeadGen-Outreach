/**
 * (dashboard)/layout.tsx — operator dashboard shell.
 *
 * Sums batches.estimated_cost_usd from this ISO week to power the top-bar
 * cost chip. Wraps every dashboard route with the same TopBar + SideNav,
 * and surfaces a ConnectSupabaseBanner when env vars aren't configured.
 */

import { TopBar } from "@/components/TopBar";
import { SideNav } from "@/components/SideNav";
import { ConnectSupabaseBanner } from "@/components/ConnectSupabaseBanner";
import { safeDb } from "@/lib/safe-db";

async function getCostThisWeekUsd(): Promise<number | undefined> {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  const rows = await safeDb(
    async (db) => {
      const { data } = await db
        .from("batches")
        .select("estimated_cost_usd")
        .gte("created_at", monday.toISOString());
      return (data ?? []) as { estimated_cost_usd: number | null }[];
    },
    [] as { estimated_cost_usd: number | null }[],
  );
  if (rows.length === 0) return undefined;
  return rows.reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cost = await getCostThisWeekUsd();
  return (
    <div className="min-h-screen bg-surface text-ink">
      <TopBar costThisWeekUsd={cost} />
      <ConnectSupabaseBanner />
      <div className="flex pt-12">
        <SideNav />
        <main className="flex-1 md:ml-60 p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
