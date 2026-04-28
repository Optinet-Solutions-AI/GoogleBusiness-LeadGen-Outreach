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
      <div>
        <h1 className="text-headline-sm text-slate-900 tracking-tight">Status</h1>
        <p className="text-body-sm text-slate-500">Week {week}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Batches" value={numbers.batches} hint="this week" />
        <StatCard label="Leads scraped" value={numbers.leads} hint="this week" />
        <StatCard label="Sites deployed" value={numbers.sites} emphasis hint="this week" />
        <StatCard label="Replies" value={numbers.replies} hintTone="positive" hint="this week" />
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-label-caps text-slate-400 uppercase mb-4 tracking-wider">
          Notes — docs/status/{week}.md
        </h2>
        {md ? (
          <pre className="whitespace-pre-wrap text-body-sm font-sans text-slate-700">{md}</pre>
        ) : (
          <p className="text-sm text-slate-500">
            No status file yet for this week. Run the <code className="bg-slate-100 px-1.5 py-0.5 rounded">/status-reporter</code>{" "}
            skill from Claude Code, or create <code className="bg-slate-100 px-1.5 py-0.5 rounded">docs/status/{week}.md</code> by hand.
          </p>
        )}
      </section>
    </div>
  );
}
