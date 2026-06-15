/**
 * backfill-reaudit-unreachable.ts — Re-audit leads previously flagged
 * improve_website solely because the old auditor returned `unreachable`.
 *
 * Usage (from web/):
 *   npx tsx scripts/backfill-reaudit-unreachable.ts          # dry-run
 *   npx tsx scripts/backfill-reaudit-unreachable.ts --apply  # write
 *
 * Compute-only (headless audits) — NO paid API. Skips offer_locked leads.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";
import { auditWebsite } from "@/lib/services/website-auditor";
import { routeOffer } from "@/lib/offers";
import type { WebsiteKind } from "@/lib/services/types";

const CONCURRENCY = 4;

interface Row {
  id: string;
  business_name: string | null;
  website_url: string | null;
  website_kind: WebsiteKind | null;
  website_issues: string[] | null;
  offer_locked: boolean | null;
  batch_id: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const { data, error } = await db
    .from("leads")
    .select("id,business_name,website_url,website_kind,website_issues,offer_locked,batch_id")
    .eq("has_website", true)
    .eq("needs_improvement", true);
  if (error) throw new Error(error.message);

  const candidates = (data ?? []).filter(
    (r: Row) =>
      !r.offer_locked &&
      !!r.website_url &&
      Array.isArray(r.website_issues) &&
      r.website_issues.length === 1 &&
      r.website_issues[0] === "unreachable",
  ) as Row[];

  console.log(`Candidates (unreachable-only, unlocked): ${candidates.length}`);

  const country = new Map<string, string>();
  const batchIds = [...new Set(candidates.map((c) => c.batch_id).filter(Boolean))] as string[];
  if (batchIds.length) {
    const { data: batches } = await db.from("batches").select("id,country_code").in("id", batchIds);
    for (const b of batches ?? []) country.set(b.id, b.country_code ?? "us");
  }

  let cleared = 0, stillImprove = 0, idx = 0;
  const queue = [...candidates];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      const n = ++idx;
      try {
        const audit = await auditWebsite(r.website_url!, {
          websiteKind: r.website_kind,
          countryCode: r.batch_id ? country.get(r.batch_id) ?? null : null,
        });
        const route = routeOffer({ has_website: true, needs_improvement: audit.needs_improvement });
        const after =
          audit.needs_improvement === true
            ? "improve"
            : audit.needs_improvement === null
              ? "unverified"
              : "healthy";
        if (after === "improve") stillImprove++; else cleared++;
        console.log(
          `  [${n}/${candidates.length}] ${after.padEnd(10)} ${audit.status.padEnd(12)} ${r.business_name} — ${r.website_url}`,
        );
        if (apply) {
          const { error: uErr } = await db
            .from("leads")
            .update({
              website_score: audit.score,
              website_issues: audit.issues,
              needs_improvement: audit.needs_improvement,
              website_status: audit.status,
              call_segment: route.segment,
              primary_offer: route.primary_offer,
              secondary_offer: route.secondary_offer,
            })
            .eq("id", r.id);
          if (uErr) console.error(`     update failed: ${uErr.message}`);
        }
      } catch (e) {
        console.error(`  [${n}] audit failed for ${r.website_url}: ${String(e).slice(0, 160)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(queue.length, 1)) }, worker));

  console.log(`\nWould clear from improve: ${cleared}   still improve: ${stillImprove}`);
  if (!apply) console.log("Dry-run only. Re-run with --apply to write.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
