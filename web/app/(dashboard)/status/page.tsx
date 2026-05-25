/**
 * (dashboard)/status/page.tsx — Weekly status.
 *
 * Computes top-line numbers from the DB and renders the current week's
 * docs/status/YYYY-Www.md as plain text below.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function weekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
}

async function getNumbers() {
  const since = weekStart().toISOString();
  try {
    const db = getDb();
    const [batches, leadsScraped, sitesDeployed, replies] = await Promise.all([
      db.from("batches").select("id", { count: "exact", head: true }).gte("created_at", since),
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since),
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since).not("demo_url", "is", null),
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since).eq("stage", "replied"),
    ]);
    return {
      batches: batches.count ?? 0,
      leads: leadsScraped.count ?? 0,
      sites: sitesDeployed.count ?? 0,
      replies: replies.count ?? 0,
    };
  } catch {
    return { batches: 0, leads: 0, sites: 0, replies: 0 };
  }
}

async function loadWeekFile(week: string): Promise<string | null> {
  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    return await fs.readFile(path.join(repoRoot, "docs", "status", `${week}.md`), "utf-8");
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const week = isoWeek();
  const numbers = await getNumbers();
  const md = await loadWeekFile(week);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <p className="eyebrow mb-2">Weekly report</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">Status</h1>
        <p className="mono-num text-[12px] text-ink-muted mt-2">Week {week}</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Batches" value={numbers.batches} hint="this week" />
        <StatCard label="Leads scraped" value={numbers.leads} hint="this week" />
        <StatCard label="Sites deployed" value={numbers.sites} emphasis hint="this week" />
        <StatCard label="Replies" value={numbers.replies} hintTone="positive" hint="this week" />
      </div>

      <section className="bg-surface border border-rule rounded-lg p-6">
        <h2 className="eyebrow mb-4">Notes — docs/status/{week}.md</h2>
        {md ? (
          <pre className="whitespace-pre-wrap text-[13px] font-sans text-ink leading-relaxed">{md}</pre>
        ) : (
          <p className="text-[13px] text-ink-muted">
            No status file yet for this week. Run the{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">/status-reporter</code>{" "}
            skill from Claude Code, or create{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded font-mono text-[12px]">docs/status/{week}.md</code>{" "}
            by hand.
          </p>
        )}
      </section>
    </div>
  );
}
