/**
 * facts.ts — validate extracted facts against their sources, assemble/merge/diff brand profiles.
 *
 * Inputs:  ExtractedFact[], PageRef[], BrandProfileData values
 * Outputs: kept/dropped facts, assembled profile, merged profile, changed paths
 * Used by: Brand Brain build stage, draft review/merge API (pure — no DB, no network)
 */
import {
  EMPTY_PROFILE,
  type BrandProfileData,
  type ExtractedFact,
  type PageRef,
  type ProductSnapshot,
  type SourceKind,
} from "./types";

export function normalizeForMatch(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type DropReason = "unknown_page" | "quote_not_found" | "missing_quote";

export function validateFacts(
  facts: ExtractedFact[],
  pages: PageRef[],
): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: DropReason }[] } {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const kept: ExtractedFact[] = [];
  const dropped: { fact: ExtractedFact; reason: DropReason }[] = [];
  for (const fact of facts) {
    if (fact.source === "operator" || fact.source === "google_maps") {
      kept.push(fact);
      continue;
    }
    const page = byId.get(fact.source);
    if (!page) {
      dropped.push({ fact, reason: "unknown_page" });
      continue;
    }
    const quote = fact.quote ? normalizeForMatch(fact.quote) : "";
    if (!quote) {
      dropped.push({ fact, reason: "missing_quote" });
      continue;
    }
    if (!normalizeForMatch(page.text).includes(quote)) {
      dropped.push({ fact, reason: "quote_not_found" });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isFact = (v: unknown): boolean => isObj(v) && "value" in v && "source" in v;

/** Parent object + last key for a dotted path (a trailing `[]` is stripped); null if not in the shape. */
function locateAny(root: Obj, path: string): { parent: Obj; key: string } | null {
  const segs = (path.endsWith("[]") ? path.slice(0, -2) : path).split(".");
  let cur: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (!isObj(cur) || !(seg in cur)) return null;
    cur = cur[seg];
  }
  const key = segs[segs.length - 1];
  return isObj(cur) && key in cur ? { parent: cur, key } : null;
}

export function assembleProfile(facts: ExtractedFact[], pages: PageRef[]): BrandProfileData {
  const profile = structuredClone(EMPTY_PROFILE) as unknown as Obj;
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const f of facts) {
    if (f.path.startsWith("products") || f.path === "visuals.logo_asset_id") continue;
    const loc = locateAny(profile, f.path);
    if (!loc) continue;
    const slot = loc.parent[loc.key];
    const isList = f.path.endsWith("[]");
    // list paths must target an array slot; scalar paths a (null) Fact slot — never groups
    if (isList ? !Array.isArray(slot) : slot !== null) continue;
    const page = byId.get(f.source);
    const kind: SourceKind =
      f.source === "operator" ? "operator" : f.source === "google_maps" ? "google_maps" : "website";
    const entry = {
      value: f.value,
      source: { kind, url: page?.url ?? null, page_id: page ? page.id : null, quote: f.quote },
      confirmed: f.source === "operator",
    };
    if (isList) (slot as unknown[]).push(entry);
    else loc.parent[loc.key] = entry;
  }
  return profile as unknown as BrandProfileData;
}

function mergeProducts(current: ProductSnapshot[], draft: ProductSnapshot[]): ProductSnapshot[] {
  const out = current.map((p) => ({ ...p }));
  for (const d of draft) {
    const i = out.findIndex((p) => p.name.toLowerCase() === d.name.toLowerCase());
    if (i >= 0) out[i] = { ...d, id: out[i].id ?? d.id };
    else out.push({ ...d });
  }
  return out;
}

export function mergeDraft(current: BrandProfileData, draft: BrandProfileData, paths: string[]): BrandProfileData {
  const out = structuredClone(current);
  for (const path of paths) {
    if (path === "products" || path === "products[]") {
      out.products = mergeProducts(current.products, draft.products);
      continue;
    }
    const to = locateAny(out as unknown as Obj, path);
    const from = locateAny(draft as unknown as Obj, path);
    if (!to || !from) continue;
    to.parent[to.key] = structuredClone(from.parent[from.key]);
  }
  return out;
}

export function diffPaths(a: BrandProfileData, b: BrandProfileData): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (path === "products") {
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push(path);
      return;
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}[]`);
      return;
    }
    if (isObj(x) && isObj(y) && !isFact(x) && !isFact(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
      return;
    }
    const vx = isFact(x) ? (x as Obj).value : x;
    const vy = isFact(y) ? (y as Obj).value : y;
    if (JSON.stringify(vx ?? null) !== JSON.stringify(vy ?? null)) out.push(path);
  };
  walk(a, b, "");
  return out;
}
