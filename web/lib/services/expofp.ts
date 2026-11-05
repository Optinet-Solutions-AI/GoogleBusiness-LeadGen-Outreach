/**
 * expofp.ts — exhibitor list of an ExpoFP interactive floor plan (the plan publishes it as a public data file).
 *
 * Inputs:  an ExpoFP plan slug / URL (`<slug>.expofp.com`), or any HTML that links to one
 * Outputs: ExpoFpExhibitor[] — name, website, description, socials, booth numbers; plus the event title / dates
 * Used by: lib/services/exhibitors.ts
 *
 * `https://<slug>.expofp.com/data/data.js` is `var __data = {...}` with `exhibitors[]` and `booths[]`
 * (each booth lists the exhibitor ids on it). Public, no key, no bot wall. Pure helpers are unit-tested.
 */
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("expofp");

export interface ExpoFpExhibitor {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  booths: string[];
  socials: { facebook?: string; instagram?: string; linkedin?: string; twitter?: string };
}

export interface ExpoFpPlan {
  slug: string;
  title: string | null;
  subtitle: string | null;
  start_date: string | null;
  end_date: string | null;
  home_url: string | null;
  exhibitors: ExpoFpExhibitor[];
}

/** `<slug>.expofp.com` slugs mentioned in a page or URL (the shared app hosts — app/demo/blog/www — excluded). Pure. */
export function expoFpSlugs(htmlOrUrl: string): string[] {
  const out = new Set<string>();
  for (const m of htmlOrUrl.matchAll(/https?:\/\/([a-z0-9-]+)\.expofp\.com/gi)) {
    const s = m[1].toLowerCase();
    if (!["app", "demo", "blog", "www", "api", "cdn", "static"].includes(s)) out.add(s);
  }
  return [...out];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Parse `data/data.js` (`var __data = {...};`) or plain JSON. Pure; throws on garbage. */
export function parseExpoFpData(source: string, slug: string): ExpoFpPlan {
  const json = source.replace(/^﻿/, "").replace(/^\s*var\s+__data\s*=\s*/, "").replace(/;\s*$/, "");
  const d = JSON.parse(json) as {
    title?: string;
    subtitle?: string;
    startDate?: string;
    endDate?: string;
    homeUrl?: string;
    exhibitors?: Array<Record<string, unknown>>;
    booths?: Array<{ name?: string; exhibitors?: number[] }>;
  };
  const boothsOf = new Map<number, string[]>();
  for (const b of d.booths ?? []) {
    const name = str(b.name);
    if (!name) continue;
    for (const id of b.exhibitors ?? []) boothsOf.set(id, [...(boothsOf.get(id) ?? []), name]);
  }
  const exhibitors: ExpoFpExhibitor[] = [];
  for (const e of d.exhibitors ?? []) {
    const name = str(e.name);
    const id = Number(e.id);
    if (!name || !Number.isFinite(id)) continue;
    let website = str(e.website);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    exhibitors.push({
      id,
      name,
      website,
      description: str(e.description)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null,
      booths: boothsOf.get(id) ?? [],
      socials: { facebook: str(e.facebook) ?? undefined, instagram: str(e.instagram) ?? undefined, linkedin: str(e.linkedin) ?? undefined, twitter: str(e.twitter) ?? undefined },
    });
  }
  return { slug, title: str(d.title), subtitle: str(d.subtitle), start_date: str(d.startDate), end_date: str(d.endDate), home_url: str(d.homeUrl), exhibitors };
}

export async function fetchExpoFpPlan(slug: string): Promise<ExpoFpPlan> {
  const url = `https://${slug}.expofp.com/data/data.js`;
  const res = await retry(
    async () => {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (RateUp exhibitor finder)" }, signal: AbortSignal.timeout(30_000) });
      if (r.status >= 500) throw new Error(`expofp ${r.status}`);
      return r;
    },
    { maxAttempts: 2 },
  );
  if (!res.ok) throw new Error(`expofp ${slug}: ${res.status}`);
  const plan = parseExpoFpData(await res.text(), slug);
  log.info({ slug, title: plan.title, exhibitors: plan.exhibitors.length, with_site: plan.exhibitors.filter((e) => e.website).length }, "expofp.plan");
  return plan;
}
