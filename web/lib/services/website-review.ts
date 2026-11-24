/**
 * website-review.ts — check a business's website with OpenAI: open the homepage, screenshot it, measure it, ask AI.
 *
 * Inputs:  { url, business_name, category, city, country_code, key (file name for the screenshot) }
 * Outputs: WebsiteReview | null (null = page didn't load or the AI answer couldn't be read: the free check stays)
 * Used by: lib/pipeline/stage-1-scrape.ts (every lead with a website, during scraping),
 *          lib/leads/website-recheck.ts (the lead page's "Check website again", Cloud Run MODE=website-review)
 *
 * Needs headless Chromium, so Cloud Run only (no-op elsewhere: the page never loads). One page load with images on,
 * a 1280×1600 JPEG of the top of the homepage (kept in the public `lead-screenshots` bucket under website-reviews/),
 * then one Responses-API call (model OPENAI_WEBSITE_MODEL) with the screenshot + measurements + page text and a
 * strict JSON schema. About 1 cent a site. Rules and the answer format: lib/leads/website-review.ts.
 */
import "@/lib/server-guard";
import type { BrowserContext } from "playwright";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { getBrowser, buildProxyOptions } from "./headless-browser";
import { isAiContactsConfigured, lookupCostUsd } from "./openai-contacts";
import { failOpenAi, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";
import {
  REVIEW_SCHEMA,
  bookingFrom,
  parseReview,
  platformFrom,
  reviewPrompt,
  type SiteSignals,
  type WebsiteReview,
} from "@/lib/leads/website-review";

const log = getLogger("website-review");
const URL_RESPONSES = "https://api.openai.com/v1/responses";
const BUCKET = "lead-screenshots";
const NAV_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const isWebsiteReviewConfigured = isAiContactsConfigured;

type Capture = { shot: Buffer; signals: SiteSignals; text: string };

/** Open the homepage (images on), measure it and screenshot the top. null when it doesn't load. */
async function capture(url: string, countryCode: string | null): Promise<Capture | null> {
  let context: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    const proxy = buildProxyOptions(countryCode);
    context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 1600 },
      locale: "en-US",
      ...(proxy ? { proxy } : {}),
    });
    const page = await context.newPage();
    const started = Date.now();
    const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    const status = nav?.status() ?? 0;
    if (!nav || status < 200 || status >= 400) {
      log.info({ url, status }, "website_review.no_page");
      return null;
    }
    const loadSeconds = Math.round((Date.now() - started) / 100) / 10;
    // Let images and late layout settle a little before the screenshot.
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    const finalUrl = page.url();
    const html = (await page.content().catch(() => "")) ?? "";
    const text = ((await page.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+\n/g, "\n").trim();
    const generator = await page.locator('meta[name="generator"]').first().getAttribute("content").catch(() => null);
    const mobileMeta = await page.locator('meta[name="viewport"]').count().then((n) => n > 0).catch(() => false);
    const hasForm = await page
      .locator("form textarea, form input[type=email]")
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    const title = (await page.title().catch(() => "")) || null;
    const shot = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });

    const years = (text.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number).filter((y) => y >= 1995 && y <= new Date().getFullYear() + 1);
    const signals: SiteSignals = {
      final_url: finalUrl,
      https: finalUrl.startsWith("https://"),
      mobile_meta: mobileMeta,
      load_seconds: loadSeconds,
      copyright_year: years.length ? Math.max(...years) : null,
      has_contact_form: hasForm,
      has_booking: bookingFrom({ text, html }),
      platform: platformFrom({ generator, html }),
      title: title ? title.slice(0, 160) : null,
    };
    return { shot, signals, text };
  } catch (err) {
    log.warn({ url, err: String(err).slice(0, 200) }, "website_review.capture_failed");
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/** Keep the screenshot in public Storage so the lead page can show it. null when the upload fails (review still kept). */
async function saveShot(key: string, shot: Buffer): Promise<string | null> {
  try {
    const db = getDb();
    const path = `website-reviews/${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
    const { error } = await db.storage.from(BUCKET).upload(path, shot, { contentType: "image/jpeg", upsert: true });
    if (error) {
      log.warn({ key, err: error.message }, "website_review.upload_failed");
      return null;
    }
    // A new check reuses the path: add a version so browsers don't show the old picture.
    return `${db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  } catch (err) {
    log.warn({ key, err: String(err).slice(0, 200) }, "website_review.upload_failed");
    return null;
  }
}

type ResponseBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function reviewWebsite(b: {
  key: string;
  url: string;
  business_name: string;
  category: string | null;
  city: string | null;
  country_code: string | null;
}): Promise<WebsiteReview | null> {
  if (!isWebsiteReviewConfigured()) return null;
  const started = Date.now();
  const cap = await capture(b.url, b.country_code);
  if (!cap) return null;

  const prompt = reviewPrompt({ business_name: b.business_name, category: b.category, city: b.city, url: b.url, signals: cap.signals, text: cap.text });
  const image = `data:image/jpeg;base64,${cap.shot.toString("base64")}`;
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_WEBSITE_MODEL,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: image }] }],
          text: { format: { type: "json_schema", name: "website_review", schema: REVIEW_SCHEMA, strict: true } },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (await shouldRetryOpenAi(r)) throw new Error(`openai ${r.status}`);
      return r;
    },
    // One try: a vision call that timed out on our side may still be billed, so it's never sent twice.
    { maxAttempts: 1 },
  );
  if (!res.ok) {
    log.warn({ url: b.url, status: res.status }, "website_review.openai_error");
    await failOpenAi(res, "website-review");
  }
  await recordOpenAiResult("ok", "website-review");
  const body = (await res.json()) as ResponseBody;
  const text = (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const screenshotUrl = await saveShot(b.key, cap.shot);
  const review = parseReview(raw, {
    signals: cap.signals,
    screenshot_url: screenshotUrl,
    model: env.OPENAI_WEBSITE_MODEL,
    usd: lookupCostUsd(body.usage, 0),
    checked_at: new Date().toISOString(),
  });
  log.info({ url: b.url, verdict: review?.verdict ?? null, score: review?.score ?? null, usd: review?.usd, ms: Date.now() - started }, "website_review.done");
  return review;
}
