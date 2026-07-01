/**
 * email-auth.ts — DNS-based sender-domain authentication check (SPF / DKIM / DMARC).
 *
 * Inputs:  a sending domain (e.g. "rateuphub.com")
 * Outputs: DomainAuth { spf, dkim, dmarc, dmarcPolicy } from DNS TXT lookups
 * Used by: app/(dashboard)/email-accounts/page.tsx (per-mailbox auth badge)
 *
 * Why: a mailbox only lands in the inbox reliably when its domain publishes
 * SPF + DKIM + DMARC. This surfaces that posture per connected mailbox so the
 * operator can see at a glance whether a sender is inbox-ready. It is NOT a
 * deliverability guarantee (reputation, warmup, content still matter) — it's
 * the foundational auth check.
 */
import "@/lib/server-guard";

export interface DomainAuth {
  domain: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  /** "none" | "quarantine" | "reject" | null — null when DMARC absent. */
  dmarcPolicy: string | null;
}

// DKIM selectors to probe, in order. Titan/Bluehost (our provider) uses
// `titan1`; the rest are common fallbacks so the check still works if a
// mailbox is later moved to another host.
const DKIM_SELECTORS = ["titan1", "default", "titan", "s1", "selector1", "google", "k1"];

/**
 * Resolve TXT records via DNS-over-HTTPS (Google, Cloudflare fallback). DoH is
 * used instead of node:dns/promises resolveTxt because the latter depends on
 * the host's configured resolver (which fails in some serverless/dev envs);
 * an HTTPS fetch to a public resolver works everywhere, including edge.
 */
async function txt(name: string): Promise<string[]> {
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as { Answer?: { type: number; data: string }[] };
      // TXT record type = 16. Strip the surrounding quotes DoH wraps each
      // record in, and collapse multi-chunk records (`"part1" "part2"`).
      return (json.Answer ?? [])
        .filter((a) => a.type === 16)
        .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
    } catch {
      // try the next endpoint
    }
  }
  return [];
}

export async function checkDomainAuth(domain: string): Promise<DomainAuth> {
  const [root, dmarcRecs] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);

  const spf = root.some((r) => /v=spf1/i.test(r));

  const dmarcRec = dmarcRecs.find((r) => /v=DMARC1/i.test(r));
  const dmarc = !!dmarcRec;
  const policy = dmarcRec?.match(/\bp\s*=\s*(none|quarantine|reject)/i);
  const dmarcPolicy = policy ? policy[1].toLowerCase() : null;

  let dkim = false;
  for (const sel of DKIM_SELECTORS) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    if (recs.some((r) => /v=DKIM1|k=rsa|p=[A-Za-z0-9]/i.test(r))) {
      dkim = true;
      break;
    }
  }

  return { domain, spf, dkim, dmarc, dmarcPolicy };
}

/** Check several domains at once, deduped — returns a domain→auth map. */
export async function checkDomainsAuth(domains: string[]): Promise<Map<string, DomainAuth>> {
  const unique = [...new Set(domains.filter(Boolean))];
  const results = await Promise.all(unique.map((d) => checkDomainAuth(d)));
  return new Map(results.map((r) => [r.domain, r]));
}
