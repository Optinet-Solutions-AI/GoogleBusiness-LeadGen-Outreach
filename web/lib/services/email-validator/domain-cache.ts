/**
 * domain-cache.ts — per-domain catch-all/MX intel, reused for 7 days. Only
 * meaningful when SMTP probing runs (local backfill); prod skips it.
 *
 * Inputs:  domain string, DB table `domain_email_intel`
 * Outputs: cached intel row or null; upserts fresh intel after a live probe
 * Used by: lib/services/email-validator/index.ts (verifyEmail, smtpEnabled branch)
 */
import { getDb } from "../../db";
import { getLogger } from "../../logger";

const log = getLogger("verify.domain-cache");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function isFresh(checkedAt: string, now: number = Date.now()): boolean {
  return now - Date.parse(checkedAt) < SEVEN_DAYS_MS;
}

export async function getDomainIntel(
  domain: string,
): Promise<{ is_catch_all: boolean | null; checked_at: string } | null> {
  const { data } = await getDb()
    .from("domain_email_intel")
    .select("is_catch_all,checked_at")
    .eq("domain", domain)
    .maybeSingle();
  if (!data || !isFresh(data.checked_at)) return null;
  return data as { is_catch_all: boolean | null; checked_at: string };
}

export async function putDomainIntel(
  domain: string,
  intel: {
    mx_top: string | null;
    provider_type: string | null;
    is_catch_all: boolean | null;
  },
): Promise<void> {
  await getDb()
    .from("domain_email_intel")
    .upsert(
      { domain, ...intel, checked_at: new Date().toISOString() },
      { onConflict: "domain" },
    )
    .then(({ error }) => {
      if (error) log.warn({ domain, err: error.message }, "domain-cache.put_failed");
    });
}
