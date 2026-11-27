/**
 * brain/attachments.ts — the files the operator attaches to a Brain job: which kind each is, a list's rows, the brief's
 * text, the limits (27 Nov 2026, spec docs/superpowers/specs/2026-11-27-brain-composer-design.md). Pure (safe in
 * client components: the box checks the files before sending).
 *
 * Inputs:  file names / sizes; a list's table (rows of cells); the businesses we already know (contacted or opted out)
 * Outputs: FILE_LIMITS · fileKind · checkFiles · parseCsv · rowsFromTable (ImportRow[] + what was skipped and why) ·
 *          filterKnown · websiteKindOf · clipBrief · importEstimate · attachmentsLine
 * Used by: lib/brain/read-files.ts, lib/brain/jobs.ts, app/api/brain/jobs/route.ts, components/brain/{Composer,JobView}.tsx
 */

export const FILE_LIMITS = { maxFiles: 5, maxBytes: 4 * 1024 * 1024, maxRows: 1000, maxBriefChars: 6000 } as const;

const LIST_EXT = ["csv", "xlsx"];
const BRIEF_EXT = ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp"];
export const ACCEPT = [...LIST_EXT, ...BRIEF_EXT].map((e) => `.${e}`).join(",");

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

export function fileKind(name: string): "list" | "brief" | null {
  const e = ext(name);
  return LIST_EXT.includes(e) ? "list" : BRIEF_EXT.includes(e) ? "brief" : null;
}

export function checkFiles(files: { name: string; size: number }[]): { ok: true } | { ok: false; message: string } {
  if (files.length > FILE_LIMITS.maxFiles) return { ok: false, message: `Attach at most ${FILE_LIMITS.maxFiles} files at a time.` };
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > FILE_LIMITS.maxBytes) return { ok: false, message: "The files are too big together (4 MB at most). Split a big list into smaller files." };
  for (const f of files) if (!fileKind(f.name)) return { ok: false, message: `${f.name}: I can't read this kind of file` };
  if (files.filter((f) => fileKind(f.name) === "list").length > 1) return { ok: false, message: "Attach one list at a time." };
  return { ok: true };
}

/** A CSV file as rows of cells: BOM removed, separator guessed (`,` `;` or tab), quotes and newlines in quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const sep = [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportRow {
  business_name: string;
  website_url: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  country_code: string | null;
}

type Field = keyof ImportRow;
const ALIASES: [Field, string[]][] = [
  ["business_name", ["business name", "company name", "business", "company", "name"]],
  ["website_url", ["website", "url", "site", "web"]],
  ["email", ["email", "e-mail", "mail", "email address"]],
  ["phone", ["phone", "tel", "telephone", "mobile", "phone number"]],
  ["address", ["address"]],
  ["city", ["city", "town"]],
  ["category", ["category", "type", "niche", "industry"]],
  ["country_code", ["country"]],
];

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");

/** A phone as a match key: its last 10 digits (as lib/suppression.ts normalizePhone), so "(512) 555-0100",
 *  "+1 512-555-0100" and "15125550100" are one number. Under 7 digits = not a phone. */
export function phoneKey(v: string | null): string | null {
  const d = digits(v);
  return d.length >= 7 ? d.slice(-10) : null;
}

/** Country names as files write them → the 2-letter code the EU / UK rules read (review C1). */
const COUNTRY_NAMES: Record<string, string> = {
  "united states": "us", "united states of america": "us", usa: "us", "u.s.": "us", "u.s.a.": "us", america: "us",
  "united kingdom": "gb", uk: "gb", "great britain": "gb", britain: "gb", england: "gb", scotland: "gb", wales: "gb", "northern ireland": "gb",
  austria: "at", belgium: "be", bulgaria: "bg", croatia: "hr", cyprus: "cy", "czech republic": "cz", czechia: "cz", denmark: "dk",
  estonia: "ee", finland: "fi", france: "fr", germany: "de", deutschland: "de", greece: "gr", hungary: "hu", ireland: "ie",
  italy: "it", italia: "it", latvia: "lv", lithuania: "lt", luxembourg: "lu", malta: "mt", netherlands: "nl", "the netherlands": "nl",
  holland: "nl", poland: "pl", portugal: "pt", romania: "ro", slovakia: "sk", slovenia: "si", spain: "es", "españa": "es",
  sweden: "se", norway: "no", iceland: "is", liechtenstein: "li", switzerland: "ch",
  canada: "ca", australia: "au", "new zealand": "nz", israel: "il", india: "in", mexico: "mx", brazil: "br",
  "south africa": "za", "united arab emirates": "ae", uae: "ae",
};

export function countryCodeOf(v: string | null | undefined): string | null {
  const t = clean(v ?? "").toLowerCase();
  if (!t) return null;
  if (COUNTRY_NAMES[t]) return COUNTRY_NAMES[t];
  return /^[a-z]{2}$/.test(t) ? t : null;
}

/** Hosts many businesses share: their pages are told apart by the path, never by the host (review I2). */
const SHARED_HOSTS = new Set(["linktr.ee", "sites.google.com", "google.com", "g.page", "goo.gl", "maps.app.goo.gl", "yelp.com", "tripadvisor.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "wa.me"]);

/** One business's website as a match key: the host of its own site, or the whole page address on a shared host
 *  (facebook.com/joe ≠ facebook.com/mary). null for a placeholder ("N/A", "-") or no website. */
export function siteKey(url: string | null): string | null {
  const host = hostOf(url);
  if (!host || !host.includes(".")) return null;
  if (websiteKindOf(url) === "real" && !SHARED_HOSTS.has(host)) return host;
  let path = "";
  try {
    path = new URL(/^https?:\/\//i.test(url!) ? url! : `https://${url}`).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return null;
  }
  return `${host}${path}`;
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

type Skip = { reason: string; count: number };
function tally(reasons: string[]): Skip[] {
  const out: Skip[] = [];
  for (const r of reasons) {
    const s = out.find((x) => x.reason === r);
    if (s) s.count++;
    else out.push({ reason: r, count: 1 });
  }
  return out;
}

export function rowsFromTable(table: string[][]): { ok: true; rows: ImportRow[]; skipped: Skip[] } | { ok: false; message: string } {
  const header = (table[0] ?? []).map((h) => clean(h).toLowerCase());
  const col = new Map<Field, number>();
  for (const [field, names] of ALIASES) {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0 && ![...col.values()].includes(i)) {
        col.set(field, i);
        break;
      }
    }
  }
  if (!col.has("business_name")) return { ok: false, message: "I need a column with the business name" };
  const get = (r: string[], f: Field) => (col.has(f) ? clean(r[col.get(f)!]) : "");

  const skipped: string[] = [];
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (const r of table.slice(1)) {
    const name = get(r, "business_name");
    if (!name) {
      skipped.push("no business name");
      continue;
    }
    const site = get(r, "website_url");
    const email = get(r, "email").toLowerCase();
    const url = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null;
    const row: ImportRow = {
      business_name: name.slice(0, 200),
      // "N/A", "-", "none": not a website (no dot in the host).
      website_url: url && siteKey(url) ? url : null,
      email: email.includes("@") ? email : null,
      phone: get(r, "phone") || null,
      address: get(r, "address") || null,
      city: get(r, "city") || null,
      category: get(r, "category") || null,
      country_code: countryCodeOf(get(r, "country_code")),
    };
    const keys = [row.email, phoneKey(row.phone), siteKey(row.website_url)].filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k))) {
      skipped.push("duplicate");
      continue;
    }
    keys.forEach((k) => seen.add(k));
    if (rows.length >= FILE_LIMITS.maxRows) {
      skipped.push("over the 1,000 row limit");
      continue;
    }
    rows.push(row);
  }
  return { ok: true, rows, skipped: tally(skipped) };
}

/** Businesses we already know, by email / phoneKey / siteKey, with why each is skipped. */
export interface KnownContacts {
  emails: Set<string>;
  phones: Set<string>;
  hosts: Set<string>;
  reason: Map<string, string>;
}

export function filterKnown(rows: ImportRow[], known: KnownContacts): { rows: ImportRow[]; skipped: Skip[] } {
  const kept: ImportRow[] = [];
  const reasons: string[] = [];
  for (const r of rows) {
    const keys: string[] = [];
    if (r.email && known.emails.has(r.email)) keys.push(r.email);
    const ph = phoneKey(r.phone);
    if (ph && known.phones.has(ph)) keys.push(ph);
    const site = siteKey(r.website_url);
    if (site && known.hosts.has(site)) keys.push(site);
    if (keys.length) reasons.push(known.reason.get(keys[0]) ?? "already contacted");
    else kept.push(r);
  }
  return { rows: kept, skipped: tally(reasons) };
}

export function websiteKindOf(url: string | null): "real" | "facebook" | "instagram" | "linkedin" | "none" {
  const h = hostOf(url);
  if (!h) return "none";
  if (/(^|\.)(facebook|fb)\.com$/.test(h)) return "facebook";
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)linkedin\.com$/.test(h)) return "linkedin";
  return "real";
}

/** An imported row as a lead of the import batch (place_id is added by the caller). A row with no country takes the
 *  batch's, so the EU / UK rules (judge, batch email, calls) still apply to it (review C1). */
export function importLeadRow(r: ImportRow, batchId: string, batchCountry: string) {
  const kind = websiteKindOf(r.website_url);
  return {
    batch_id: batchId,
    business_name: r.business_name,
    website_url: r.website_url,
    website_kind: kind,
    has_website: kind === "real",
    email: r.email,
    phone: r.phone,
    address: r.address ?? r.city,
    category: r.category,
    country_code: r.country_code ?? batchCountry,
    stage: "scraped" as const,
    qualified: true,
  };
}

export const clipBrief = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, FILE_LIMITS.maxBriefChars);

/** The checks on an imported lead: AI Lookup 2¢ + website check 1¢ + lead score 0.5¢. */
export const importEstimate = (rows: number): number => Math.round(rows * 0.035 * 100) / 100;

export interface AttachmentNote {
  name: string;
  kind: "list" | "brief";
  used?: number;
  skipped?: Skip[];
  note?: string;
}

/** "Using: a.csv (212 leads, 3 skipped: no business name) · b.pdf (brief)" */
export function attachmentsLine(list: AttachmentNote[]): string {
  if (!list.length) return "";
  const part = (a: AttachmentNote) => {
    if (a.kind === "brief") return `${a.name} (${a.note ? `brief: ${a.note}` : "brief"})`;
    const skipped = (a.skipped ?? []).filter((s) => s.count > 0);
    const n = skipped.reduce((s, x) => s + x.count, 0);
    return `${a.name} (${a.used ?? 0} leads${n ? `, ${n} skipped: ${skipped.map((s) => s.reason).join(", ")}` : ""})`;
  };
  return `Using: ${list.map(part).join(" · ")}`;
}
