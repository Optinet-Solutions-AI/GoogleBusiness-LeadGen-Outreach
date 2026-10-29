/**
 * company-website.ts — find a closing company's own website and phone without a search API.
 *
 * Inputs:  a company name (WARN notice employer); a website URL for the phone crawl
 * Outputs: findCompanyWebsite → "https://<domain>" when a guessed domain serves a real page
 *          that names the company; findWebsitePhone → first US phone on the home/contact page
 * Used by: lib/pipeline/signal-enrich.ts (liquidation / WARN leads)
 *
 * Free search engines block bots, so we guess domains from the name ("Expedia, Inc." →
 * expedia.com) and verify each by fetching it: it must answer 2xx/3xx HTML, mention the
 * company's main word, and not be a parked "domain for sale" page.
 */
import { log } from "@/lib/logger";

const SUFFIXES = /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|lp|llp|plc|holdings?|group|the|usa|us|of america)\b\.?/gi;
const PARKED = /(domain (is )?for sale|buy this domain|this domain may be for sale|parked (free|domain)|godaddy\.com\/forsale|sedo\.com|dan\.com\/buy)/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Company name → its significant words, lowercased ("Joe's Pizza & Grill, Inc." → ["joes","pizza","and","grill"]). */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Likely domains for a company name, most likely first, de-duplicated. */
export function guessDomains(name: string): string[] {
  const t = nameTokens(name).filter((w) => w !== "and");
  if (!t.length) return [];
  const out = [t.join("") + ".com"];
  if (t.length > 1) out.push(t.join("-") + ".com");
  if (t.length > 1 && t[0].length >= 4) out.push(t[0] + ".com");
  return [...new Set(out)].filter((d) => d.length <= 40);
}

/** First US phone number in a page: tel: links first, then visible text. */
export function extractUsPhone(html: string): string | null {
  const tel = html.match(/href=["']tel:([+\d\s().-]{10,20})["']/i);
  const raw = tel?.[1] ?? html.replace(/<[^>]+>/g, " ").match(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/)?.[0];
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10 || !/^[2-9]\d{2}[2-9]/.test(d)) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": UA, accept: "text/html" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

/** True when the page plausibly belongs to the company (names it, not parked). Pure. */
export function pageMatchesCompany(html: string, name: string): boolean {
  if (PARKED.test(html)) return false;
  const main = nameTokens(name).find((w) => w.length >= 4 && w !== "and");
  if (!main) return false;
  return html.toLowerCase().includes(main);
}

export async function findCompanyWebsite(name: string): Promise<string | null> {
  for (const domain of guessDomains(name)) {
    const url = `https://${domain}`;
    const html = await fetchHtml(url);
    if (html && pageMatchesCompany(html, name)) {
      log.info({ name, url }, "company_website.found");
      return url;
    }
  }
  log.info({ name }, "company_website.none");
  return null;
}

export async function findWebsitePhone(websiteUrl: string): Promise<string | null> {
  const base = websiteUrl.replace(/\/+$/, "");
  for (const u of [base, `${base}/contact`, `${base}/contact-us`]) {
    const html = await fetchHtml(u);
    const phone = html ? extractUsPhone(html) : null;
    if (phone) return phone;
  }
  return null;
}
