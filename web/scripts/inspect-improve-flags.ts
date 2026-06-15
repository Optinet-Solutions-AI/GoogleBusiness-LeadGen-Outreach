/**
 * inspect-improve-flags.ts — READ-ONLY: why are leads tagged "improve_website"?
 *
 * Usage: npx tsx scripts/inspect-improve-flags.ts   (from web/)
 *
 * No writes, no paid calls. Among real-website leads, shows the distribution of
 * website_issues + scores that drove needs_improvement=true, so we can see which
 * heuristic over-fires on decent sites.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";

interface Row {
  business_name: string | null;
  website_url: string | null;
  website_kind: string | null;
  website_score: number | null;
  website_issues: string[] | null;
  needs_improvement: boolean | null;
  call_segment: string | null;
  primary_offer: string | null;
}

async function main() {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select(
      "business_name,website_url,website_kind,website_score,website_issues,needs_improvement,call_segment,primary_offer",
    )
    .eq("has_website", true);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const improve = rows.filter((r) => r.needs_improvement === true);
  console.log(`Real-website leads: ${rows.length}`);
  console.log(`Tagged needs_improvement: ${improve.length}\n`);

  // Which single issues appear, and how often they are the ONLY issue.
  const issueCount = new Map<string, number>();
  const soleIssueCount = new Map<string, number>();
  const scoreHist = new Map<number, number>();
  for (const r of improve) {
    const issues = r.website_issues ?? [];
    for (const i of issues) issueCount.set(i, (issueCount.get(i) ?? 0) + 1);
    if (issues.length === 1) soleIssueCount.set(issues[0], (soleIssueCount.get(issues[0]) ?? 0) + 1);
    const s = r.website_score ?? -1;
    scoreHist.set(s, (scoreHist.get(s) ?? 0) + 1);
  }

  console.log("Issue frequency among flagged leads:");
  for (const [i, n] of [...issueCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${i}`);
  }
  console.log("\nFlagged by a SINGLE issue (the borderline/false-positive risk):");
  for (const [i, n] of [...soleIssueCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${i}`);
  }
  console.log("\nScore distribution among flagged leads:");
  for (const [s, n] of [...scoreHist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  score ${String(s).padStart(3)}: ${n}`);
  }

  // Sample the highest-scoring flagged leads — most likely to be "actually decent".
  const suspicious = improve
    .filter((r) => (r.website_score ?? 0) >= 50)
    .sort((a, b) => (b.website_score ?? 0) - (a.website_score ?? 0))
    .slice(0, 15);
  console.log(`\nHighest-scoring flagged leads (most likely false positives):`);
  for (const r of suspicious) {
    console.log(
      `  [${r.website_score}] ${r.business_name} — ${r.website_url}\n` +
        `        issues=${JSON.stringify(r.website_issues)} kind=${r.website_kind}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
