/**
 * exhibitor-pages.ts — read a conference's exhibitor page: fetch it (politely), turn it into text, let Gemini list the exhibitors.
 *
 * Inputs:  a page URL (exhibitor list, floor plan, sponsors) + the event name
 * Outputs: PageRead { blocked, text, expofp_slugs } and ExtractedExhibitor[] — company, booth, website, country
 * Used by: lib/services/exhibitors.ts
 *
 * A site that answers with a bot challenge (Cloudflare "Just a moment…", captcha) is reported as `blocked` and left
 * alone — we never try to get around it. JS-only pages are rendered once with the shared Chromium when available
 * (Cloud Run); locally the plain HTML is used. Pure helpers are unit-tested.
 */
import "@/lib/server-guard";
import { z } from "zod";
import { Type } from "@google/genai";
import { getLogger } from "../logger";
import { structuredCall } from "./gemini-brand";

const log = getLogger("exhibitor-pages");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 RateUp-exhibitor-finder";
export const PAGE_TEXT_BUDGET = 60_000;

/** True when the HTML is a bot-check interstitial rather than the page. Pure. */
export function isBotChallenge(html: string): boolean {
  const head = html.slice(0, 4000);
  return /Just a moment\.\.\.|cf-chl|challenges\.cloudflare\.com|_cf_chl_opt|Attention Required!|captcha-delivery|px-captcha|Access Denied/i.test(head);
}

/** HTML → readable text (scripts/styles/nav dropped, links kept as "text (url)"). Pure. */
export function htmlToText(html: string, limit = PAGE_TEXT_BUDGET): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return t && !/expofp\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com/i.test(href) ? ` ${t} (${href}) ` : ` ${t} `;
    })
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|td|th|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  if (s.length > limit) s = s.slice(0, limit);
  return s;
}

export interface PageRead {
  url: string;
  status: number;
  blocked: boolean;
  text: string;
  html: string;
  rendered: boolean;
}

/** Fetch a page; render with Chromium when the HTML is a JS shell and a browser is available. Never throws. */
export async function readPage(url: string, opts: { render?: boolean } = {}): Promise<PageRead> {
  let html = "";
  let status = 0;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    status = r.status;
    html = await r.text();
  } catch (err) {
    log.warn({ url, err: String(err).slice(0, 120) }, "exhibitor_pages.fetch_failed");
    return { url, status, blocked: false, text: "", html: "", rendered: false };
  }
  if (isBotChallenge(html)) {
    log.info({ url, status }, "exhibitor_pages.blocked");
    return { url, status, blocked: true, text: "", html, rendered: false };
  }
  let text = htmlToText(html);
  let rendered = false;
  // A JS app shell: the server HTML has almost no words. Render once if Chromium is here.
  if (opts.render !== false && text.length < 1500) {
    try {
      const { getBrowser } = await import("./headless-browser");
      const browser = await getBrowser();
      const ctx = await browser.newContext({ userAgent: UA });
      try {
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
        const rhtml = await page.content();
        if (!isBotChallenge(rhtml)) {
          html = rhtml;
          text = htmlToText(rhtml);
          rendered = true;
        }
      } finally {
        await ctx.close().catch(() => undefined);
      }
    } catch (err) {
      log.info({ url, err: String(err).slice(0, 120) }, "exhibitor_pages.render_skipped");
    }
  }
  return { url, status, blocked: false, text, html, rendered };
}

export const ExtractedExhibitorSchema = z.object({
  company: z.string().min(1),
  booth: z.string().nullable(),
  website: z.string().nullable(),
  country: z.string().nullable(),
  role: z.enum(["exhibitor", "sponsor", "partner", "organiser", "media", "unknown"]),
});
export type ExtractedExhibitor = z.infer<typeof ExtractedExhibitorSchema>;
const Output = z.object({ exhibitors: z.array(ExtractedExhibitorSchema) });

const S = { type: Type.STRING };
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    exhibitors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          company: S,
          booth: { type: Type.STRING, nullable: true },
          website: { type: Type.STRING, nullable: true },
          country: { type: Type.STRING, nullable: true },
          role: { type: Type.STRING, enum: ["exhibitor", "sponsor", "partner", "organiser", "media", "unknown"] },
        },
        required: ["company", "booth", "website", "country", "role"],
      },
    },
  },
  required: ["exhibitors"],
};

const SYSTEM = `You read the text of a conference / trade-show web page and list the companies that have a booth or stand there.
Rules:
- Return every company that is exhibiting, sponsoring with a stand, or listed with a booth/stand number. Skip the organiser, the venue, media partners without a stand, speakers' employers, and navigation words.
- company: the company name exactly as written (no booth number, no "Ltd" cleanup).
- booth: the stand/booth number if next to the name (e.g. "A12", "Hall 3 – 3B20"), else null.
- website: the company's own site if a link or domain is shown next to it, else null. Never guess.
- country: the ISO-2 country code if shown, else null.
- role: exhibitor (has a stand), sponsor, partner, organiser, media, or unknown.
- If the page is not an exhibitor list (an article, a ticket page…) return an empty list.`;

/** Ask Gemini for the exhibitors in a page's text. One Flash call per page; may return []. */
export async function extractExhibitors(text: string, eventName: string): Promise<ExtractedExhibitor[]> {
  if (text.trim().length < 80) return [];
  const prompt = `# EVENT\n${eventName}\n\n# PAGE TEXT\n${text.slice(0, PAGE_TEXT_BUDGET)}`;
  const { output } = await structuredCall<z.infer<typeof Output>>({ label: "exhibitors", system: SYSTEM, prompt, responseSchema: SCHEMA, zod: Output });
  return output.exhibitors.filter((e) => e.company.trim().length > 1);
}
