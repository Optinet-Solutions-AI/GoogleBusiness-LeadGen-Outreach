/**
 * crawl-social.ts — pull a Facebook/Instagram page's public meta into a brand brain source.
 *
 * Inputs:  SourceRow (kind facebook|instagram), ClientRow
 * Outputs: logo brand_asset (og:image) + one source_pages row (og title/description)
 * Used by: the crawl job (Task 8)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fetchSocialPageMeta } from "@/lib/services/playwright-logo";
import { copyRemoteImage } from "@/lib/clients/assets";
import type { ClientRow } from "@/lib/clients/clients";
import type { SourceRow } from "@/lib/clients/sources";

const log = getLogger("crawl-social");

export async function crawlSocial(
  source: SourceRow,
  client: ClientRow,
): Promise<{ status: "partial" | "blocked" }> {
  const db = getDb();
  const kind = source.kind === "instagram" ? "instagram" : "facebook";
  let meta: Awaited<ReturnType<typeof fetchSocialPageMeta>> = null;
  let lastError: string | null = null;
  try {
    if (source.url) meta = await fetchSocialPageMeta(source.url, kind, client.country_code ?? undefined);
  } catch (err) {
    lastError = String(err).slice(0, 300);
    log.warn({ sourceId: source.id, err: lastError }, "crawl_social.failed");
  }

  if (!meta) {
    await db
      .from("client_sources")
      .update({
        status: "blocked",
        last_crawled_at: new Date().toISOString(),
        last_error: lastError ?? "social page blocked or unavailable",
      })
      .eq("id", source.id);
    return { status: "blocked" };
  }

  await copyRemoteImage({
    clientId: client.id,
    url: meta.og_image,
    origin: kind,
    kind: "logo",
    alt: meta.og_title,
  }).catch(() => null);
  await db.from("source_pages").delete().eq("source_id", source.id);
  await db.from("source_pages").insert({
    source_id: source.id,
    client_id: client.id,
    url: source.url,
    title: meta.og_title,
    text: meta.og_description,
  });
  await db
    .from("client_sources")
    .update({ status: "partial", page_count: 1, last_crawled_at: new Date().toISOString(), last_error: null })
    .eq("id", source.id);
  return { status: "partial" };
}
