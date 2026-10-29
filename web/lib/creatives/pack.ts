/**
 * pack.ts — builds a month's download pack: approved post PNGs plus captions.csv, zipped.
 *
 * Inputs:  client id + month (YYYY-MM); creatives/versions from the DB; render PNGs from Storage
 * Outputs: zip Buffer (named PNGs + captions.csv); pure helpers packFileName / captionsCsv / packManifest / mapLimit / buildPack
 * Used by: app/api/clients/[id]/pack/route.ts
 */
import "@/lib/server-guard";
import JSZip from "jszip";
import { getDb } from "@/lib/db";
import { ASSETS_BUCKET, renderPath } from "@/lib/clients/assets";
import { getCreative, listCreatives } from "./creatives";
import type { Aspect, Platform, RenderRef } from "./types";

/** `<slot_date>_<title-slug>_<aspect with x>[_slide-N].png`; title slug max 40 chars. */
export function packFileName(slotDate: string, title: string, aspect: Aspect, slide: number | null): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "post";
  return `${slotDate}_${slug}_${aspect.replace(":", "x")}${slide == null ? "" : `_slide-${slide}`}.png`;
}

export type CaptionRow = { date: string; platform: string; caption: string; hashtags: string[]; files: string[] };

const csvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** RFC-4180 CSV (header first, CRLF line endings). */
export function captionsCsv(rows: CaptionRow[]): string {
  const lines = [["date", "platform", "caption", "hashtags", "files"].join(",")];
  for (const r of rows) {
    lines.push(
      [r.date, r.platform, r.caption, r.hashtags.join(" "), r.files.join("; ")].map(csvField).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export async function buildPack(entries: { name: string; data: Buffer | string }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) zip.file(e.name, e.data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export type PackManifest = {
  filename: string;
  files: { name: string; url: string; creative_id: string; aspect: Aspect; slide: number | null }[];
  captions_csv: string;
};

type ManifestCreative = {
  id: string;
  slot_date: string;
  title: string | null;
  platforms: Platform[];
  version: { renders: RenderRef[]; copy: Partial<Record<Platform, { caption: string; hashtags: string[] } | undefined>> };
};

/** Pure: the approved creatives' renders + captions as a manifest (null when there are no renders). */
export function packManifest(filename: string, creatives: ManifestCreative[]): PackManifest | null {
  const files: PackManifest["files"] = [];
  const rows: CaptionRow[] = [];
  for (const c of creatives) {
    const names: string[] = [];
    for (const r of c.version.renders) {
      const name = packFileName(c.slot_date, c.title ?? "post", r.aspect, r.slide);
      files.push({ name, url: r.public_url, creative_id: c.id, aspect: r.aspect, slide: r.slide });
      names.push(name);
    }
    for (const p of c.platforms) {
      const copy = c.version.copy[p];
      rows.push({ date: c.slot_date, platform: p, caption: copy?.caption ?? "", hashtags: copy?.hashtags ?? [], files: names });
    }
  }
  if (!files.length) return null;
  return { filename, files, captions_csv: captionsCsv(rows) };
}

async function approvedCreatives(clientId: string, month: string): Promise<(ManifestCreative & { version_id: string })[]> {
  const creatives = await listCreatives(clientId, { month });
  const out: (ManifestCreative & { version_id: string })[] = [];
  for (const c of creatives) {
    if (!c.slot_date) continue;
    const full = await getCreative(clientId, c.id);
    const v = full.versions.find((x) => x.state === "approved");
    if (!v) continue;
    out.push({
      id: c.id,
      slot_date: c.slot_date,
      title: c.title,
      platforms: c.platforms as Platform[],
      version_id: v.id,
      version: { renders: v.renders, copy: v.copy },
    });
  }
  return out;
}

/** The manifest for a month's approved posts; null when none is approved. */
export async function buildMonthManifest(clientId: string, month: string, filename: string): Promise<PackManifest | null> {
  return packManifest(filename, await approvedCreatives(clientId, month));
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Pack the approved version of every dated creative in the month; null when none is approved. */
export async function buildMonthPack(clientId: string, month: string): Promise<Buffer | null> {
  const db = getDb();
  const approved = await approvedCreatives(clientId, month);
  const manifest = packManifest("pack.zip", approved);
  if (!manifest) return null;
  const versionOf = new Map(approved.map((c) => [c.id, c.version_id]));
  const files = await mapLimit(manifest.files, 6, async (f) => {
    const path = renderPath(clientId, versionOf.get(f.creative_id) ?? "", f.aspect, f.slide);
    const { data, error } = await db.storage.from(ASSETS_BUCKET).download(path);
    if (error || !data) throw new Error(`render download failed (${f.name}): ${error?.message ?? "empty"}`);
    return { name: f.name, data: Buffer.from(await data.arrayBuffer()) as Buffer | string };
  });
  files.push({ name: "captions.csv", data: manifest.captions_csv });
  return buildPack(files);
}
