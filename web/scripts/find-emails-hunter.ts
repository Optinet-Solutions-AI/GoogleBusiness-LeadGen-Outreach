/**
 * scripts/find-emails-hunter.ts — Find contact emails for has-website leads via Hunter domain-search.
 *
 * Targets leads with website_kind='real', email IS NULL, website_url present (the same set the free
 * crawl couldn't resolve — usually JS-rendered sites). Does ONE Hunter domain-search per unique domain
 * (1 search credit each; ~2000 available on the Starter plan), picks the best contact (generic role
 * address like info@/contact@ preferred, else highest-confidence personal ≥50), and writes leads.email.
 * Verify afterward with `npm run verify:leads` — this only FINDS, it does not verify.
 *
 * Usage (from web/):
 *   npx tsx --tsconfig tsconfig.json scripts/find-emails-hunter.ts            (executes)
 *   npx tsx --tsconfig tsconfig.json scripts/find-emails-hunter.ts --dry-run  (counts targets only, no Hunter calls, no cost)
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const SOCIAL = /facebook\.com|instagram\.com|linktr\.ee|business\.site|google\.com/i;

interface HunterEmail {
  value: string;
  type?: string; // "generic" | "personal"
  confidence?: number;
}

function domainOf(url: string): string | null {
  try {
    const h = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    if (!h || SOCIAL.test(h)) return null;
    return h;
  } catch {
    return null;
  }
}

function pickBest(emails: HunterEmail[]): string | null {
  if (!emails?.length) return null;
  const byConf = [...emails].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const generic = byConf.find((e) => e.type === "generic");
  if (generic) return generic.value;
  const strong = byConf.find((e) => (e.confidence ?? 0) >= 50);
  return strong ? strong.value : null;
}

async function main() {
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) throw new Error("HUNTER_API_KEY not set in .env");
  const dryRun = process.argv.includes("--dry-run");

  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const { data: leads, error } = await db
    .from("leads")
    .select("id,business_name,website_url")
    .eq("website_kind", "real")
    .is("email", null)
    .not("website_url", "is", null)
    .limit(300);
  if (error) throw new Error(error.message);

  const targets = (leads ?? [])
    .map((l) => ({ ...l, domain: domainOf(l.website_url as string) }))
    .filter((l) => l.domain);

  console.log(`\n${leads?.length ?? 0} real-website leads missing an email; ${targets.length} have a usable domain.`);
  if (dryRun) {
    console.log("DRY RUN — no Hunter calls, no writes.");
    return;
  }
  console.log("Searching Hunter per domain...\n");

  const domainCache = new Map<string, string | null>();
  let hits = 0;
  for (const l of targets) {
    const domain = l.domain as string;
    try {
      let email = domainCache.get(domain);
      if (email === undefined) {
        const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          console.log(`  ✗ ${l.business_name} (${domain}) — HTTP ${resp.status}`);
          domainCache.set(domain, null);
          continue;
        }
        const json = (await resp.json()) as { data?: { emails?: HunterEmail[] } };
        email = pickBest(json.data?.emails ?? []);
        domainCache.set(domain, email);
      }
      if (email) {
        await db.from("leads").update({ email }).eq("id", l.id);
        hits += 1;
        console.log(`  ✓ ${l.business_name} → ${email}`);
      } else {
        console.log(`  · ${l.business_name} (${domain}) → (none)`);
      }
    } catch (e) {
      console.log(`  ✗ ${l.business_name} (${domain}) — ${String(e).slice(0, 80)}`);
    }
  }

  console.log(`\nDone. ${hits}/${targets.length} now have an email. Run \`npm run verify:leads\` to verify them.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
