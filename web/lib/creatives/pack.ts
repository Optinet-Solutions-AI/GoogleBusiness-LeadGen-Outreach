/**
 * pack.ts — builds a month's download pack: approved post PNGs plus captions.csv, zipped.
 *
 * Inputs:  client id + month (YYYY-MM); creatives/versions from the DB; render PNGs from Storage
 * Outputs: zip Buffer (named PNGs + captions.csv); pure helpers packFileName / captionsCsv / buildPack
 * Used by: app/api/clients/[id]/pack/route.ts
 */
import "@/lib/server-guard";
import JSZip from "jszip";
import { getDb } from "@/lib/db";
import { ASSETS_BUCKET, renderPath } from "@/lib/clients/assets";
import { getCreative, listCreatives } from "./creatives";
import type { Aspect, Platform } from "./types";

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

/** Pack the approved version of every dated creative in the month; null when none is approved. */
export async function buildMonthPack(clientId: string, month: string): Promise<Buffer | null> {
  const db = getDb();
  const creatives = await listCreatives(clientId, { month });
  const files: { name: string; data: Buffer | string }[] = [];
  const rows: CaptionRow[] = [];
  for (const c of creatives) {
    if (!c.slot_date) continue;
    const full = await getCreative(clientId, c.id);
    const v = full.versions.find((x) => x.state === "approved");
    if (!v) continue;
    const names: string[] = [];
    for (const r of v.renders) {
      const name = packFileName(c.slot_date, c.title ?? "post", r.aspect, r.slide);
      const { data, error } = await db.storage.from(ASSETS_BUCKET).download(renderPath(clientId, v.id, r.aspect, r.slide));
      if (error || !data) throw new Error(`render download failed (${name}): ${error?.message ?? "empty"}`);
      files.push({ name, data: Buffer.from(await data.arrayBuffer()) });
      names.push(name);
    }
    for (const p of c.platforms as Platform[]) {
      const copy = v.copy[p];
      rows.push({ date: c.slot_date, platform: p, caption: copy?.caption ?? "", hashtags: copy?.hashtags ?? [], files: names });
    }
  }
  if (!files.length) return null;
  files.push({ name: "captions.csv", data: captionsCsv(rows) });
  return buildPack(files);
}
