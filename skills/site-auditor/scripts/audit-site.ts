/**
 * audit-site.ts — Audit a deployed pages.dev URL (or any URL) for the
 * known anti-patterns the site-auditor skill watches for.
 *
 * Usage:
 *   NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/audit-site.ts <url>
 *
 * Side effects:
 *   - Writes served HTML to /tmp/audit/served.html
 *   - Writes 4 screenshots: /tmp/audit/{mobile,desktop}_{top,scrolled}.png
 *
 * Stdout: JSON blob with every programmatic finding + screenshot manifest.
 * Screenshot-based findings (mobile truncation, sticky CTA overlap, etc.)
 * require visual inspection by the caller — the JSON tells you WHICH
 * screenshots to look at and what to look for, but the verdict is yours.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..", "..");

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: audit-site <url>");
    process.exit(2);
  }

  const OUT_DIR = "/tmp/audit";
  await fs.mkdir(OUT_DIR, { recursive: true });

  // 1. Fetch HTML
  const htmlRes = await fetch(url, { headers: { "user-agent": "site-auditor/1.0" } });
  const html = await htmlRes.text();
  const htmlPath = `${OUT_DIR}/served.html`;
  await fs.writeFile(htmlPath, html);

  // 2. Programmatic anti-pattern checks against served HTML
  const findings: Array<{
    check: string;
    severity: "high" | "medium" | "low";
    detected: boolean;
    evidence?: string;
    hint?: string;
  }> = [];

  // fallback-navy palette
  const navy = html.match(/--c-primary:\s*31 78 121/);
  findings.push({
    check: "fallback_navy_palette",
    severity: "high",
    detected: !!navy,
    evidence: navy?.[0],
    hint: navy
      ? "Served CSS is using the FALLBACK_HEX navy. global.css :root may have defaults that override the per-build palette."
      : undefined,
  });

  // expired social CDN logos
  const fbcdn = html.match(/src=["']https:\/\/scontent[^"']*fbcdn\.net[^"']*/);
  const igCdn = html.match(/src=["']https:\/\/scontent[^"']*cdninstagram\.com[^"']*/);
  findings.push({
    check: "expired_social_cdn_logo",
    severity: "high",
    detected: !!(fbcdn || igCdn),
    evidence: (fbcdn?.[0] ?? igCdn?.[0])?.slice(0, 100),
    hint: fbcdn || igCdn
      ? "fbcdn / cdninstagram URLs expire ~3 weeks after issue. Logos should be persisted as data:image/jpeg;base64 URIs."
      : undefined,
  });

  // Raw Google category slug. Google returns snake_case lowercase
  // ("home_goods_store") which the eyebrow's `uppercase` Tailwind class
  // displays as "HOME_GOODS_STORE" to users — so we search the underlying
  // text case-insensitively. Must be `>slug<` between tags (not in an
  // attribute or JSON payload) and have ≥1 underscore + ≥10 chars to
  // avoid false positives on style/ID strings.
  const rawCategory = html.match(/>([a-z]{2,}_[a-z_]{6,})</i);
  findings.push({
    check: "raw_google_category_slug",
    severity: "medium",
    detected: !!rawCategory,
    evidence: rawCategory?.[1],
    hint: rawCategory
      ? "Raw Google taxonomy slug visible (rendered uppercase via CSS). Hero variant is rendering data.category directly — drop it from the eyebrow."
      : undefined,
  });

  // Hero rating chip. Stars + rating are split across multiple spans in
  // the rendered HTML, so we can't match the whole chip with one regex.
  // Two-prong heuristic: (a) a visible 1-decimal rating text node, AND
  // (b) the keyword "verified" or "reviews" appears within ~400 chars
  // (the eyebrow / chip block). Strip <script>s first so JSON-LD payloads
  // don't trigger the match.
  const visibleHtml = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const ratingPos = visibleHtml.search(/>\s*\d\.\d\s*</);
  let heroRatingDetected = false;
  let heroRatingEvidence: string | undefined;
  if (ratingPos > 0) {
    const rawWindow = visibleHtml.slice(Math.max(0, ratingPos - 200), ratingPos + 400);
    // Strip tags so "verified </span>reviews" becomes "verified  reviews",
    // and the keyword check actually finds adjacent words.
    const plainText = rawWindow.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/verified reviews?|google reviews?|·\s*\d+\s*reviews?/i.test(plainText)) {
      heroRatingDetected = true;
      heroRatingEvidence = plainText.slice(0, 160).trim();
    }
  }
  findings.push({
    check: "hero_rating_chip",
    severity: "medium",
    detected: heroRatingDetected,
    evidence: heroRatingEvidence,
    hint: heroRatingDetected
      ? "Rating + reviews-keyword found in visible text. Verify via the desktop_top screenshot whether it's the hero chip (anti-pattern) or just the reviews-section heading (fine)."
      : undefined,
  });

  // duplicate testimonial authors (look at data-author attrs OR repeated
  // author-style spans in the reviews section)
  const authors = Array.from(html.matchAll(/data-author=["']([^"']+)["']/g)).map((m) => m[1]);
  const authorCounts = new Map<string, number>();
  for (const a of authors) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
  const dups = [...authorCounts.entries()].filter(([, n]) => n > 1);
  findings.push({
    check: "duplicate_testimonial_authors",
    severity: "medium",
    detected: dups.length > 0,
    evidence: dups.length ? dups.map(([a, n]) => `${a}×${n}`).join(", ") : undefined,
    hint: dups.length
      ? "Marquee variant duplicates cards for the loop seam — visible duplicates mean review count is too low. Stage-3 should clamp to masonry-grid/single-featured."
      : undefined,
  });

  // empty render (build failed / wrong dist served)
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const empty = !titleMatch || !h1Match || (h1Match[1].replace(/<[^>]+>/g, "").trim().length < 5);
  findings.push({
    check: "empty_render",
    severity: "high",
    detected: empty,
    evidence: `title="${titleMatch?.[1] ?? "<missing>"}" h1.text.length=${
      h1Match?.[1]?.replace(/<[^>]+>/g, "").trim().length ?? 0
    }`,
    hint: empty
      ? "Served HTML is missing core content. Astro build may have failed or stale dist was deployed."
      : undefined,
  });

  // 3. Screenshots + DOM-level checks. Dynamic import via an absolute
  //    file:// URL — Node ESM ignores NODE_PATH for dynamic import(), so
  //    we point directly at web/node_modules/playwright where the package
  //    actually lives.
  let screenshotsTaken = false;
  const domFindings: typeof findings = [];
  try {
    const playwrightUrl = pathToFileURL(
      path.join(REPO_ROOT, "web", "node_modules", "playwright", "index.js"),
    ).href;
    const pwModule = await import(playwrightUrl);
    const chromium = pwModule.chromium ?? pwModule.default?.chromium;
    if (!chromium) throw new Error("playwright chromium export not found");
    const browser = await chromium.launch({ headless: true });
    for (const [name, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT_DIR}/${name}_top.png`, fullPage: false });

      // DOM-level checks only need to run once. Mobile gives us the
      // overflow info we care about, so we run them on the mobile pass.
      if (name === "mobile") {
        // ---- (a) Broader category-eyebrow check ----
        // The hero's eyebrow has class `eyebrow` (Tailwind component
        // class in global.css). Read its text directly so we catch
        // single-word categories like "CONSULTANT" / "PLUMBER" that the
        // regex pass missed.
        const eyebrowInfo = await page
          .evaluate(() => {
            // Strategy: pick the first uppercase-styled short text run in
            // the document that appears BEFORE the hero H1 in document
            // order. Hero variants vary in markup (.eyebrow / .eyebrow-row
            // / plain <span class="uppercase ...">) but every one renders
            // a small uppercase-styled run above the headline.
            const h1 = document.querySelector("h1");
            if (!h1) return null;
            const h1Rect = h1.getBoundingClientRect();
            const all = Array.from(document.querySelectorAll("span, div, a"));
            for (const el of all) {
              if (el === h1 || h1.contains(el)) continue;
              const txt = (el as HTMLElement).innerText?.trim() ?? "";
              if (!txt || txt.length > 120) continue;
              const cs = getComputedStyle(el);
              if (cs.textTransform !== "uppercase") continue;
              const rect = el.getBoundingClientRect();
              // Must appear ABOVE the headline (smaller y).
              if (rect.top >= h1Rect.top || rect.bottom < 0) continue;
              // Skip the sticky header itself — its descendants aren't the
              // hero eyebrow.
              if ((el.closest("#site-header") ?? null) !== null) continue;
              return { text: txt };
            }
            return null;
          })
          .catch(() => null);
        if (eyebrowInfo?.text) {
          // Category leak heuristic. textContent returns source-case text
          // (the eyebrow's `uppercase` Tailwind class only uppercases
          // visually), so normalize before pattern-matching. The eyebrow
          // is a category leak when its leading token:
          //   - has length ≥ 3
          //   - doesn't read as "locally owned ..." brand voice
          //   - doesn't read as a Title-Case place name ("Frankton",
          //     "Hamilton Frankton", "Mobile AL")
          //   - DOES look like a Google taxonomy slug (snake_case) OR a
          //     bare single-word category (one token, no spaces)
          const firstToken = eyebrowInfo.text.split(/\s*[·•|]\s*/)[0]?.trim() ?? "";
          const normalized = firstToken.toLowerCase();
          const allowed =
            /^locally\s+owned/i.test(normalized) ||
            /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(firstToken); // Title Case city
          const isSlug = normalized.includes("_"); // home_goods_store
          const isSingleWordCategory = /^[a-z]+$/.test(normalized) && normalized.length >= 5; // consultant
          const isCategoryish =
            firstToken.length >= 3 && !allowed && (isSlug || isSingleWordCategory);
          domFindings.push({
            check: "eyebrow_category_leak",
            severity: "medium",
            detected: isCategoryish,
            evidence: isCategoryish ? `"${firstToken}" (eyebrow: "${eyebrowInfo.text}")` : undefined,
            hint: isCategoryish
              ? "Eyebrow leads with a category-shaped word (raw Google taxonomy slug or a single-word category like 'CONSULTANT'). Drop data.category from the hero variant's eyebrow JSX."
              : undefined,
          });
        }

        // ---- (b) Mobile header overflow ----
        // Measure the brand <a> in the header. If its rendered height is
        // more than ~1.5× a single-line line-height, the text is wrapping
        // beyond one line — overflow.
        const headerMetrics = await page
          .evaluate(() => {
            const brand = document.querySelector("#site-header a[href='/']");
            if (!brand) return null;
            const r = brand.getBoundingClientRect();
            const ls = parseFloat(getComputedStyle(brand).lineHeight) || 24;
            return { height: r.height, width: r.width, lineHeight: ls };
          })
          .catch(() => null);
        if (headerMetrics) {
          // Allow ~1.5 line-heights for vertical padding; over that, the
          // brand wrapped to a second line.
          const overflows = headerMetrics.height > headerMetrics.lineHeight * 1.6;
          domFindings.push({
            check: "mobile_header_overflow",
            severity: "medium",
            detected: overflows,
            evidence: overflows
              ? `brand link ${headerMetrics.height.toFixed(0)}px tall (line-height ${headerMetrics.lineHeight.toFixed(0)}px) — wrapping to multiple lines on 390px`
              : undefined,
            hint: overflows
              ? "Header brand text is wrapping on mobile. Source has short-brand logic but this lead's parsed segment is still too long. Consider an explicit char cap on shortName, or use a logo-only header for this lead."
              : undefined,
          });
        }

        // ---- (c) CTA color vs brand-color match ----
        // The header pill CTA should be filled with data.palette.primary.
        // If it's rendering a different color, palette injection didn't
        // apply to it (component-level CSS scope issue, or stale bundle).
        const ctaColors = await page
          .evaluate(() => {
            // Specifically the pill CTA — header.btn-primary. The nav
            // bar also contains `<a href="/contact">Contact</a>` which is
            // transparent, so a `[href='/contact']` selector would match
            // that first and give a useless transparent reading. Walk
            // every header anchor and pick the one with a non-transparent
            // background — that's the brand-coloured pill.
            const root = document.documentElement;
            const brand = getComputedStyle(root).getPropertyValue("--c-primary").trim();
            const anchors = Array.from(
              document.querySelectorAll<HTMLElement>("#site-header a"),
            );
            for (const a of anchors) {
              const bg = getComputedStyle(a).backgroundColor;
              // Skip transparent / blank anchors (text links in the nav).
              if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
              return { ctaBg: bg, brand };
            }
            return null;
          })
          .catch(() => null);
        if (ctaColors?.ctaBg && ctaColors?.brand) {
          // brand is "R G B" triplet; ctaBg is "rgb(R, G, B)". Normalize.
          const brandRgb = ctaColors.brand.split(/\s+/).map((n) => parseInt(n, 10));
          const ctaMatch = ctaColors.ctaBg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
          const ctaRgb = ctaMatch ? [+ctaMatch[1], +ctaMatch[2], +ctaMatch[3]] : null;
          let mismatch = false;
          if (ctaRgb && brandRgb.length === 3) {
            // Allow small delta (anti-aliasing / minor adjustments) — flag
            // when each channel differs by more than 24 in 0-255 space.
            mismatch =
              Math.abs(ctaRgb[0] - brandRgb[0]) > 24 ||
              Math.abs(ctaRgb[1] - brandRgb[1]) > 24 ||
              Math.abs(ctaRgb[2] - brandRgb[2]) > 24;
          }
          domFindings.push({
            check: "cta_brand_color_mismatch",
            severity: mismatch ? "high" : "low",
            detected: mismatch,
            evidence: mismatch
              ? `cta bg=${ctaColors.ctaBg} but --c-primary=${ctaColors.brand}`
              : undefined,
            hint: mismatch
              ? "Header CTA background doesn't match the per-build palette. Likely a stale deployed bundle OR a component using a hardcoded color instead of the CSS var."
              : undefined,
          });
        }

        // ---- (d) Hero rating/star chip (broader keyword set) ----
        // Look inside whatever <section> contains the H1 for star SVGs
        // alongside a decimal rating like 4.2 / 5.0. Old check required
        // "verified reviews" wording — Mimi/Estate Sales use "Locally
        // owned" so they slipped through. Now: presence of any of stars+
        // rating+(reviews|locally owned|google|in <city>) inside the hero.
        const heroRating = await page
          .evaluate(() => {
            const h1 = document.querySelector("h1");
            if (!h1) return { detected: false, sample: "" };
            const section = h1.closest("section") || h1.closest("[class*='hero']") || h1.parentElement;
            if (!section) return { detected: false, sample: "" };
            const txt = (section as HTMLElement).innerText ?? "";
            const hasRating = /\b[1-5]\.\d\b/.test(txt);
            const hasKeyword = /\b(reviews?|locally owned|google|in \w+,?)\b/i.test(txt);
            const hasStars = !!section.querySelector(
              "svg[fill='currentColor'][class*='text-amber'], svg[class*='star'], [class*='star']",
            );
            const detected = hasRating && (hasKeyword || hasStars);
            return { detected, sample: detected ? txt.slice(0, 160) : "" };
          })
          .catch(() => ({ detected: false, sample: "" }));
        domFindings.push({
          check: "hero_rating_chip_v2",
          severity: "medium",
          detected: heroRating.detected,
          evidence: heroRating.detected ? heroRating.sample : undefined,
          hint: heroRating.detected
            ? "Hero section contains a rating display (stars + decimal rating) alongside reviews / 'locally owned' / city wording. Should live in the dedicated reviews section, not the hero."
            : undefined,
        });
      }

      await page.evaluate(() =>
        window.scrollTo({ top: 1000, behavior: "instant" as ScrollBehavior }),
      );
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT_DIR}/${name}_scrolled.png`, fullPage: false });
      await ctx.close();
    }
    await browser.close();
    screenshotsTaken = true;
  } catch (err) {
    console.error("screenshot step failed:", String(err).slice(0, 200));
  }

  // Merge DOM findings into the main list. We keep the original regex
  // checks too — they're cheap, redundant safety nets that catch issues
  // even when Playwright fails to launch.
  findings.push(...domFindings);

  // 4. Emit findings + screenshot manifest
  const screenshots = screenshotsTaken
    ? ["mobile_top", "mobile_scrolled", "desktop_top", "desktop_scrolled"].map(
        (n) => `${OUT_DIR}/${n}.png`,
      )
    : [];

  const result = {
    url,
    html_path: htmlPath,
    screenshots,
    findings,
    visual_checks_needed: [
      "Mobile header text truncation (look for ellipsis in mobile_top)",
      "Sticky CTA bar visible at bottom (mobile_scrolled — should NOT be there)",
      "Hero text obscured by sticky header on scroll (mobile_scrolled, desktop_scrolled)",
      "Logo proportions vs CTA pill (mobile_top — logo should not look like a favicon)",
      "Broken image icons (any screenshot)",
    ],
    summary: {
      high: findings.filter((f) => f.detected && f.severity === "high").length,
      medium: findings.filter((f) => f.detected && f.severity === "medium").length,
      low: findings.filter((f) => f.detected && f.severity === "low").length,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
