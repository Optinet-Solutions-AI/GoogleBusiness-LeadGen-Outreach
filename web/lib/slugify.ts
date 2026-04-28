/**
 * slugify.ts — Convert business name into a URL-safe subdomain slug.
 *
 * Inputs:  arbitrary business name string
 * Outputs: lowercase a-z0-9 + dashes, max 40 chars
 * Used by: pipeline/stage-4-deploy.ts to derive Cloudflare Pages subdomain
 */

export function slugify(text: string, maxLen = 40): string {
  const normalized = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized.slice(0, maxLen).replace(/^-+|-+$/g, "") || "site";
}
