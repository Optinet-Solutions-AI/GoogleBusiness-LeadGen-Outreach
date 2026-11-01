/**
 * website-email.ts — Best-effort contact details from a business's OWN website (free).
 *
 * Inputs:  the business website URL (a real site — not facebook/instagram), country code (proxy)
 * Outputs: findWebsiteContacts() → { email, phone, contact_url, pages_checked }; findWebsiteEmail() → email
 * Used by: lib/pipeline/stage-1-scrape.ts (at scrape time, no render), lib/pipeline/stage-2-enrich.ts,
 *          scripts/backfill-emails.ts
 *
 * How: fetch the homepage (header + footer), then the site's OWN contact / about pages found from its links
 * (any wording: "Get in touch", "Our story", "Kuntatt", "Contatti"…), then a few common paths as a last
 * guess. Emails come from mailto: links, page text, Cloudflare-protected addresses (data-cfemail, which only
 * a browser decodes) and "info [at] site [dot] com" spellings; junk (image names, builder/CDN addresses,
 * placeholders) is filtered and same-domain / role addresses win. Phone comes from tel: links. Zero paid
 * API spend; blocked sites just miss.
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

/** Contact-page words in a link's address or text (English + the languages we scrape). */
const CONTACT_WORDS = /contact|kontakt|contatt|contacto|contato|kuntatt|get[-_ ]?in[-_ ]?touch|reach[-_ ]?us|enquir|inquir|impressum|find[-_ ]?us/i;
/** About-page words. */
const ABOUT_WORDS = /about|our[-_ ]?story|who[-_ ]?we[-_ ]?are|chi[-_ ]?siamo|quienes[-_ ]?somos|sobre|uber[-_ ]?uns|ueber[-_ ]?uns|a[-_ ]?propos|our[-_ ]?team|dwarna/i;
/** Links that match the words above but are never the contact page. */
const SKIP_LINK = /privacy|terms|cookie|policy|login|cart|checkout|feed|wp-(json|content|includes)|\.(png|jpe?g|svg|webp|pdf|css|js)$/i;

/** Most pages fetched per site (homepage included). */
const MAX_PAGES = 6;

export type WebsiteContacts = {
  email: string | null;
  phone: string | null;
  /** The site's own contact page, when one was found (else null). */
  contact_url: string | null;
  pages_checked: number;
};

function normalizeSite(websiteUrl: string): URL | null {
  try {
    return new URL(websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`);
  } catch {
    return null;
  }
}

/** Common paths tried only when the site's own links didn't lead anywhere. */
function fallbackUrls(origin: string): string[] {
  return [`${origin}/contact`, `${origin}/contact-us`, `${origin}/about`, `${origin}/about-us`];
}

async function fetchText(url: string): Promise<{ html: string; finalUrl: string } | null> {
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
    return { html: (await res.text()).slice(0, 500_000), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Cloudflare email obfuscation: first byte is the XOR key for the rest. Pure. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Every email-looking string on a page: mailto, plain text, Cloudflare-protected, "[at]/[dot]" spellings. Pure. */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      found.add(m[1].toLowerCase());
    }
  }
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]{4,})"|email-protection#([0-9a-f]{4,})/gi)) {
    const e = decodeCfEmail(m[1] ?? m[2]);
    if (e.includes("@")) found.add(e.toLowerCase());
  }
  const spelled = html
    .replace(/\s*(?:\[at\]|\(at\)|\{at\})\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\})\s*/gi, ".");
  for (const m of spelled.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found];
}

/** Phone numbers from tel: links, in page order, decoded. Pure. */
export function extractPhones(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    let p = m[1];
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep raw */
    }
    p = p.trim();
    if (p.replace(/\D/g, "").length >= 7 && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The site's own contact and about pages, from its links (address or link text), same host only. Pure. */
export function contactLinks(html: string, pageUrl: string): { contact: string[]; about: string[] } {
  const base = normalizeSite(pageUrl);
  const contact: string[] = [];
  const about: string[] = [];
  if (!base) return { contact, about };
  const host = base.host.replace(/^www\./, "");
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, "") !== host) continue;
    const href = `${u.origin}${u.pathname}`;
    if (SKIP_LINK.test(u.pathname)) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hay = `${u.pathname} ${text}`;
    if (CONTACT_WORDS.test(hay)) {
      if (!contact.includes(href)) contact.push(href);
    } else if (ABOUT_WORDS.test(hay)) {
      if (!about.includes(href)) about.push(href);
    }
  }
  return { contact, about };
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

/** The best email among candidates for this site, or null. Pure. */
export function pickEmail(candidates: Iterable<string>, siteHost: string): string | null {
  const ok = [...new Set(candidates)].filter((e) => !isJunk(e));
  if (!ok.length) return null;
  return ok.sort((a, b) => score(b, siteHost) - score(a, siteHost))[0];
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

/**
 * Crawl the site for its email, phone and contact page. `render: false` skips the headless-browser
 * fallback (used at scrape time, where speed matters). Never throws.
 */
export async function findWebsiteContacts(
  websiteUrl: string,
  countryCode?: string | null,
  opts: { render?: boolean } = {},
): Promise<WebsiteContacts> {
  const none: WebsiteContacts = { email: null, phone: null, contact_url: null, pages_checked: 0 };
  const site = normalizeSite(websiteUrl);
  if (!site) return none;
  const origin = `${site.protocol}//${site.host}`;
  const home = site.pathname && site.pathname !== "/" ? `${origin}${site.pathname}` : `${origin}/`;

  const emails = new Set<string>();
  const phones: string[] = [];
  let contactUrl: string | null = null;
  let siteHost = site.host;
  let checked = 0;
  const seen = new Set<string>();

  const visit = async (url: string): Promise<string | null> => {
    if (seen.has(url) || checked >= MAX_PAGES) return null;
    seen.add(url);
    const page = await fetchText(url);
    checked++;
    if (!page) return null;
    for (const e of extractEmails(page.html)) emails.add(e);
    for (const p of extractPhones(page.html)) if (!phones.includes(p)) phones.push(p);
    return page.html;
  };

  // 1. homepage (header + footer), and where it points
  const homeHtml = await visit(home);
  let links = { contact: [] as string[], about: [] as string[] };
  if (homeHtml) {
    try {
      siteHost = new URL(home).host;
    } catch {
      /* keep */
    }
    links = contactLinks(homeHtml, home);
    contactUrl = links.contact[0] ?? null;
  }

  // 2. the site's own contact pages first, then about pages (stop once an email is in hand)
  for (const u of [...links.contact.slice(0, 2), ...links.about.slice(0, 2)]) {
    if (pickEmail(emails, siteHost)) break;
    await visit(u);
  }

  // 3. last guess: common paths (a 404 is skipped), and record a working contact path
  if (!pickEmail(emails, siteHost)) {
    for (const u of fallbackUrls(origin)) {
      const html = await visit(u);
      if (html && !contactUrl && /contact/i.test(u)) contactUrl = u;
      if (pickEmail(emails, siteHost)) break;
    }
  }

  // 4. JS-rendered sites: one headless render of the homepage
  if (!pickEmail(emails, siteHost) && opts.render !== false) {
    for (const e of await renderAndExtract(home, countryCode ?? null)) emails.add(e);
  }

  const result: WebsiteContacts = {
    email: pickEmail(emails, siteHost),
    phone: phones[0] ?? null,
    contact_url: contactUrl,
    pages_checked: checked,
  };
  log.info({ websiteUrl, ...result, candidates: emails.size }, result.email ? "website_email.found" : "website_email.none");
  return result;
}

/** Crawl the site for the best contact email. Returns null on miss / blocked / no site. */
export async function findWebsiteEmail(websiteUrl: string, countryCode?: string | null): Promise<string | null> {
  return (await findWebsiteContacts(websiteUrl, countryCode)).email;
}
