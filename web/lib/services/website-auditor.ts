/**
 * website-auditor.ts — Score an existing business website for "needs improvement".
 *
 * Inputs:  website URL + { websiteKind, countryCode }
 * Outputs: WebsiteAudit { score, issues[], needs_improvement, reachability, status } — never throws
 * Used by: lib/pipeline/stage-1-scrape.ts (enrichOne), stage-2-enrich.ts
 *
 * One headless-Chromium page load per audit, reusing the shared browser
 * singleton (headless-browser.ts) — same pattern as playwright-logo.ts.
 * On ANY failure (timeout, nav error, 4xx/5xx) we return an `unreachable`
 * verdict, which the offer router treats as "needs improvement" (a dead or
 * broken site is the strongest improve/build signal there is).
 *
 * Scoring (see workflows/audit_website.md): each issue subtracts a penalty
 * from 100; needs_improvement = score < THRESHOLD, an auto-flag issue, or a dead verdict.
 *
 * Cost: compute only — no paid API. Safe to run on every website-having lead.
 */

import type { BrowserContext, Page, Route } from "playwright";
import { getBrowser, buildProxyOptions } from "./headless-browser";
import { getLogger } from "../logger";
import type { WebsiteKind } from "./types";

const log = getLogger("website-auditor");

const NAV_TIMEOUT_MS = 8_000;
const HARD_TIMEOUT_MS = 9_000;
/** Below this score (or any unreachable) → pitch website improvement. */
export const NEEDS_IMPROVEMENT_THRESHOLD = 60;
/** load time over this many ms trips the `slow` issue. */
const SLOW_LOAD_MS = 4_000;

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type WebsiteIssue =
  | "no_https"
  | "not_mobile"
  | "slow"
  | "stale_content"
  | "diy_builder";

export type Reachability = "reachable" | "dead" | "blocked" | "unverified";

/** Penalty each content issue subtracts from the 100-point health score. */
const ISSUE_PENALTY: Record<WebsiteIssue, number> = {
  no_https: 25,
  not_mobile: 25,
  slow: 15,
  stale_content: 15,
  diy_builder: 20,
};

/** website_kind values that are free DIY builders (a soft "needs improvement" signal). */
const DIY_BUILDER_KINDS: ReadonlySet<WebsiteKind> = new Set([
  "wix_free",
  "weebly",
  "webnode",
  "blogspot",
  "wordpress",
  "sites_google",
  "carrd",
]);

export interface WebsiteAudit {
  /** 0–100 content-health score. null when blocked/unverified (not scored). */
  score: number | null;
  /** Content issues only (https/mobile/slow/stale/diy). Never includes reachability. */
  issues: WebsiteIssue[];
  /** true = pitch improve; false = healthy; null = couldn't verify (unknown). */
  needs_improvement: boolean | null;
  reachability: Reachability;
  /** HTTP status code or error token, e.g. "200" | "404" | "403 blocked" | "timeout". */
  status: string;
}

export interface AuditOptions {
  websiteKind?: WebsiteKind | null;
  countryCode?: string | null;
}

/**
 * Issues that flag "needs improvement" on their own when the site is reachable,
 * regardless of score. http-only (−25) lands at 75, which wouldn't trip the
 * threshold otherwise, so it's promoted to an automatic flag.
 */
const AUTO_FLAG_ISSUES: ReadonlySet<WebsiteIssue> = new Set(["no_https"]);

export type ReachabilityInput =
  | { kind: "http"; statusCode: number }
  | { kind: "error"; error: "timeout" | "dns_error" | "conn_refused" | "unknown" };

/**
 * Map a raw HTTP status OR network-error kind to a reachability verdict + a
 * human status string. Only genuinely-dead results (404/410/5xx/dns/refused)
 * count as dead; bot-protection codes (401/403/429) are "blocked" (the site is
 * alive, we just can't inspect it); timeouts/ambiguous → "unverified".
 */
export function classifyReachability(input: ReachabilityInput): { reachability: Reachability; status: string } {
  if (input.kind === "error") {
    switch (input.error) {
      case "dns_error": return { reachability: "dead", status: "dns_error" };
      case "conn_refused": return { reachability: "dead", status: "conn_refused" };
      case "timeout": return { reachability: "unverified", status: "timeout" };
      default: return { reachability: "unverified", status: "error" };
    }
  }
  const code = input.statusCode;
  if (code >= 200 && code < 400) return { reachability: "reachable", status: String(code) };
  if (code === 404 || code === 410) return { reachability: "dead", status: String(code) };
  if (code >= 500) return { reachability: "dead", status: String(code) };
  if (code === 401 || code === 403 || code === 429) return { reachability: "blocked", status: `${code} blocked` };
  return { reachability: "unverified", status: String(code) };
}

/**
 * Combine a reachability verdict with the content issues (only gathered when
 * reachable) into the final WebsiteAudit. A free DIY-builder site is a known
 * improve target even when we couldn't load it, so it survives blocked/unverified.
 *
 * @param contentIssues Only meaningful when reachability === "reachable"; ignored otherwise.
 */
export function buildVerdict(args: {
  reachability: Reachability;
  status: string;
  contentIssues: WebsiteIssue[];
  isDiyBuilder: boolean;
}): WebsiteAudit {
  const { reachability, status, contentIssues, isDiyBuilder } = args;

  if (reachability === "reachable") {
    const penalty = contentIssues.reduce((sum, i) => sum + ISSUE_PENALTY[i], 0);
    const score = Math.max(0, 100 - penalty);
    const needs_improvement =
      score < NEEDS_IMPROVEMENT_THRESHOLD || contentIssues.some((i) => AUTO_FLAG_ISSUES.has(i));
    return { score, issues: contentIssues, needs_improvement, reachability, status };
  }

  if (reachability === "dead") {
    // A dead/gone domain that was a known free builder is still a known improve target.
    return { score: 0, issues: isDiyBuilder ? ["diy_builder"] : [], needs_improvement: true, reachability, status };
  }

  // blocked | unverified — couldn't inspect. Unknown unless it's a known free builder.
  return isDiyBuilder
    ? { score: null, issues: ["diy_builder"], needs_improvement: true, reachability, status }
    : { score: null, issues: [], needs_improvement: null, reachability, status };
}

/**
 * Audit a website URL. Returns a verdict for every input — an unreachable /
 * erroring site yields `{ score: 0, issues: ['unreachable'], needs_improvement: true }`.
 */
export async function auditWebsite(
  url: string,
  opts: AuditOptions = {},
): Promise<WebsiteAudit> {
  const issues = new Set<WebsiteIssue>();

  // Static signal: a free DIY builder is "needs improvement" even before we load it.
  if (opts.websiteKind && DIY_BUILDER_KINDS.has(opts.websiteKind)) {
    issues.add("diy_builder");
  }

  const startMs = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    const proxy = buildProxyOptions(opts.countryCode);
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      ...(proxy ? { proxy } : {}),
      bypassCSP: true,
    });

    // Drop heavy resources — we only need the DOM/meta tags + a status code.
    await context.route("**/*", (route: Route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") {
        return route.abort();
      }
      route.continue();
    });

    page = await context.newPage();

    const nav = await Promise.race([
      page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HARD_TIMEOUT_MS)),
    ]);
    const loadMs = Date.now() - startMs;

    // Timeout or dead response → unreachable, nothing more to measure.
    const status = nav?.status() ?? 0;
    if (!nav || status >= 400) {
      issues.add("unreachable");
      log.info({ url, status, loadMs }, "auditor.unreachable");
      return verdict([...issues]);
    }

    // HTTPS — read the FINAL url (an http→https redirect counts as OK).
    const finalUrl = page.url();
    if (!finalUrl.startsWith("https://")) issues.add("no_https");

    if (loadMs > SLOW_LOAD_MS) issues.add("slow");

    // Mobile-responsive: a viewport meta tag is the cheap, reliable proxy.
    const hasViewport = await page
      .locator('meta[name="viewport"]')
      .first()
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    if (!hasViewport) issues.add("not_mobile");

    // Stale: missing meta description OR thin body text OR an old copyright year.
    const metaDesc = await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
    const copyrightYear = newestYear(bodyText);
    const currentYear = new Date().getFullYear();
    const thin = bodyText.trim().length < 400;
    const noDesc = !metaDesc || metaDesc.trim().length === 0;
    const oldCopyright = copyrightYear !== null && currentYear - copyrightYear > 2;
    if (thin || noDesc || oldCopyright) issues.add("stale_content");

    const result = verdict([...issues]);
    log.info(
      { url, status, loadMs, finalUrl, issues: result.issues, score: result.score },
      "auditor.done",
    );
    return result;
  } catch (err) {
    issues.add("unreachable");
    log.warn(
      { url, err: String(err).slice(0, 200), durationMs: Date.now() - startMs },
      "auditor.failed",
    );
    return verdict([...issues]);
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}

/** Largest 19xx/20xx year mentioned in the text (typically the footer copyright). */
function newestYear(text: string): number | null {
  const matches = text.match(/\b(19|20)\d{2}\b/g);
  if (!matches) return null;
  const years = matches.map(Number).filter((y) => y >= 1990 && y <= new Date().getFullYear() + 1);
  return years.length ? Math.max(...years) : null;
}
