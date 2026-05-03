/**
 * robots.txt.ts — Per-site /robots.txt generator.
 *
 * Inputs:  Astro.site (set from SITE_URL at build time by stage-3-generate)
 * Outputs: text/plain robots policy. Allow-all for search bots; explicit
 *          allow for AI / LLM crawlers per the 2026 AEO playbook (we want
 *          citations, not opacity); absolute Sitemap URL.
 * Used by: Lighthouse SEO audit, Googlebot, GPTBot, ClaudeBot, etc.
 */
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.toString().replace(/\/$/, "") ?? "";

  // AI/LLM crawler allowlist — keep in sync with the meta robots
  // max-snippet:-1 directive in Base.astro. Closing one without the other
  // produces inconsistent signals.
  const aiBots = [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "Google-Extended",
    "PerplexityBot",
    "Applebot-Extended",
    "Bytespider",
    "CCBot",
    "Meta-ExternalAgent",
  ];

  const txt = [
    "# Search engines — full crawl",
    "User-agent: *",
    "Allow: /",
    "",
    "# AI / LLM crawlers — explicit allow per 2026 AEO guidance.",
    "# Pair with <meta name=\"robots\" content=\"max-snippet:-1\"> for AEO citations.",
    ...aiBots.flatMap((bot) => [`User-agent: ${bot}`, "Allow: /", ""]),
    `Sitemap: ${baseUrl}/sitemap-index.xml`,
    "",
  ].join("\n");

  return new Response(txt, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
