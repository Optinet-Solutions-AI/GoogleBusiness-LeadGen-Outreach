/**
 * website-email.ts — Best-effort contact email from a business's OWN website (free).
 *
 * Inputs:  the business website URL (a real site — not facebook/instagram)
 * Outputs: the best contact email found, or null
 * Used by: lib/pipeline/stage-2-enrich.ts (only for website_kind === 'real')
 *
 * How: plain fetch of the homepage + a few common contact pages, then pull emails from
 * `mailto:` links + page text, filter out junk (image filenames, builder/CDN addresses,
 * hashed garbage), and prefer same-domain / role addresses. Zero paid API spend — no Outscraper,
 * no Hunter. SMB sites are usually simple enough that a plain fetch works; blocked sites just miss.
 *
 * This is the email source for the EMAIL channel (has-website leads). No-website leads have no
 * site to crawl — they go to the DM/SMS channel instead, so this is never called for them.
 */

import { getLogger } from "../logger";
import { getBrowser, buildProxyOptions } from "./headless-browser";

const log = getLogger("website-email");

// Addresses that are never a real business contact (page builders, CDNs, analytics, placeholders).
const JUNK_DOMAINS = [
  "example.com", "example.org", "domain.com", "yourdomain.com", "email.com", "company.com",
  "sentry.io", "wixpress.com", "wix.com", "squarespace.com", "godaddy.com", "shopify.com",
  "cloudflare.com", "schema.org", "w3.org", "googleapis.com", "gstatic.com", "google.com",
  "fontawesome.com", "jquery.com", "sentry-next.wixpress.com",
];
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ROLE_LOCAL = /^(info|contact|hello|hi|sales|enquiries?|inquiries?|admin|office|bookings?|reception|team|support|mail)/i;

/** Origin + a few likely contact pages to try (homepage first). */
function candidateUrls(websiteUrl: string): string[] {
  try {
    const u = new URL(websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`);
    const origin = `${u.protocol}//${u.host}`;
    const home = u.pathname && u.pathname !== "/" ? `${origin}${u.pathname}` : `${origin}/`;
    return [home, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`, `${origin}/about-us`];
  } catch {
    return [];
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RateUpLeadBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      found.add(m[1].toLowerCase());
    }
  }
  for (const m of html.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found];
}

function isJunk(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 1) return true;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return true;
  if (IMG_EXT.test(email)) return true; // image filename slurped as "email"
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(domain)) return true;
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (local.length > 40 || email.length > 64) return true;
  if (/^[0-9a-f]{16,}$/i.test(local)) return true; // hashed local part (tracking pixels etc.)
  // Obvious placeholder / sample addresses copied from a template (example@mail.com, your@..., name@...).
  if (/^(examples?|your(name|email|mail)?|name|e-?mail|mail|test|sample|user(name)?|first(name)?|last(name)?|john\.?doe|jane\.?doe)$/i.test(local)) {
    return true;
  }
  return false;
}

function score(email: string, siteHost: string): number {
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  let s = 0;
  const host = siteHost.replace(/^www\./, "");
  if (host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`))) s += 10;
  if (ROLE_LOCAL.test(local)) s += 3;
  if (/(gmail|yahoo|hotmail|outlook|aol|icloud)\./.test(domain)) s += 1; // SMBs often use free mail
  return s;
}

/** Render the homepage with Playwright (through the residential proxy) and pull emails — the
 *  fallback for JS-rendered sites a plain fetch can't read. Only used when plain fetch found none. */
async function renderAndExtract(url: string, countryCode: string | null): Promise<string[]> {
  try {
    const browser = await getBrowser();
    const proxy = buildProxyOptions(countryCode);
    const context = await browser.newContext(proxy ? { proxy } : {});
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(1500); // let JS hydrate
      const html = await page.content();
      return extractEmails(html).filter((e) => !isJunk(e));
    } finally {
      await context.close();
    }
  } catch (e) {
    log.warn({ url, err: String(e).slice(0, 120) }, "website_email.render_failed");
    return [];
  }
}

/** Crawl the site for the best contact email. Returns null on miss / blocked / no site. */
export async function findWebsiteEmail(websiteUrl: string, countryCode?: string | null): Promise<string | null> {
  const urls = candidateUrls(websiteUrl);
  if (urls.length === 0) return null;

  let siteHost = "";
  try {
    siteHost = new URL(urls[0]).host;
  } catch {
    /* ignore */
  }

  const all = new Set<string>();
  for (const u of urls) {
    const html = await fetchText(u);
    if (!html) continue;
    for (const e of extractEmails(html)) if (!isJunk(e)) all.add(e);
    if (all.size >= 5) break; // plenty to choose from
  }

  // Plain fetch missed — many SMB sites only expose the email after JS renders. Try a render pass.
  if (all.size === 0) {
    for (const e of await renderAndExtract(urls[0], countryCode ?? null)) all.add(e);
  }

  if (all.size === 0) {
    log.info({ websiteUrl }, "website_email.none");
    return null;
  }
  const best = [...all].sort((a, b) => score(b, siteHost) - score(a, siteHost))[0];
  log.info({ websiteUrl, candidates: all.size, best }, "website_email.found");
  return best;
}
