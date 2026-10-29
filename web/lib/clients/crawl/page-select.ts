/**
 * page-select.ts — Pick which pages of a site to crawl, and order crawled pages for the prompt.
 *
 * Inputs:  home page HTML + base URL; or a list of crawled { url, title }
 * Outputs: absolute same-site URLs to fetch; or the pages re-ordered by importance
 * Used by: the Brand Brain website crawler and Gemini prompt builder
 *
 * Pure, regex-based (no dependency), bounded patterns so large pages stay linear.
 */

export const CRAWL_KEYWORDS = [
  "about", "service", "product", "shop", "menu", "pricing", "price", "faq",
  "contact", "team", "review", "testimonial", "gallery", "portfolio", "work",
];

const FILE_EXT =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|bmp|avif|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|mp3|mp4|mov|avi|wmv|webm|xml|json|txt|css|js|woff2?|ttf|eot|apk|exe|dmg)$/i;

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, "");

export function sameSite(a: URL, b: URL): boolean {
  return stripWww(a.hostname) === stripWww(b.hostname);
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
}

function isRootPath(u: URL): boolean {
  return u.pathname === "/" || u.pathname === "";
}

/** Identity of a page for dedupe: host without www + path without trailing slash. */
function pageKey(u: URL): string {
  return stripWww(u.hostname) + (u.port ? ":" + u.port : "") + (u.pathname.replace(/\/+$/, "") || "/");
}

function keywordRank(url: string, anchorText: string): number {
  const hay = `${new URL(url).pathname} ${anchorText}`.toLowerCase();
  for (let i = 0; i < CRAWL_KEYWORDS.length; i++) if (hay.includes(CRAWL_KEYWORDS[i])) return i;
  return -1;
}

export function pickCrawlLinks(homeHtml: string, baseUrl: string, max: number): string[] {
  const limit = max - 1;
  if (limit <= 0) return [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseKey = pageKey(base);

  const seen = new Set<string>();
  const found: { url: string; rank: number }[] = [];

  for (const m of homeHtml.matchAll(/<a\b[^<>]*>/gi)) {
    const tag = m[0];
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "").trim() : "";
    if (!href || /^(mailto:|tel:|javascript:|sms:|data:)/i.test(href) || href.startsWith("#")) continue;

    let u: URL;
    try {
      u = new URL(decodeEntities(href), base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (!sameSite(u, base)) continue;
    u.hash = "";
    u.search = "";
    if (FILE_EXT.test(u.pathname)) continue;
    const key = pageKey(u);
    if (isRootPath(u) || key === baseKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = u.toString();

    const start = (m.index ?? 0) + tag.length;
    const after = homeHtml.slice(start, start + 300);
    const end = after.search(/<\/a\s*>/i);
    const anchor = decodeEntities((end === -1 ? after : after.slice(0, end)).replace(/<[^<>]*>/g, " ")).replace(/\s+/g, " ").trim();
    found.push({ url, rank: keywordRank(url, anchor) });
  }

  const keyword = found.filter((f) => f.rank >= 0).sort((a, b) => a.rank - b.rank); // stable: ties keep document order
  const rest = found.filter((f) => f.rank < 0);
  return [...keyword, ...rest].slice(0, limit).map((f) => f.url);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const PROMPT_GROUPS: RegExp[] = [/about/, /service|product|shop|menu/, /pricing|price/, /contact/];

export function rankPagesForPrompt(
  pages: { url: string; title: string | null }[],
): { url: string; title: string | null }[] {
  if (pages.length === 0) return [];
  let homeIdx = pages.findIndex((p) => {
    const path = pathOf(p.url);
    return path === "/" || path === "";
  });
  if (homeIdx === -1) homeIdx = 0;

  const scored = pages.map((p, i) => {
    let group: number;
    if (i === homeIdx) group = -1;
    else {
      const hay = `${pathOf(p.url)} ${p.title ?? ""}`.toLowerCase();
      const g = PROMPT_GROUPS.findIndex((re) => re.test(hay));
      group = g === -1 ? PROMPT_GROUPS.length : g;
    }
    return { p, i, group };
  });
  scored.sort((a, b) => a.group - b.group || a.i - b.i);
  return scored.map((s) => s.p);
}
