/**
 * profile-paths.ts — editable-field map of the brand profile plus immutable path helpers (pure).
 *
 * Inputs:  BrandProfileData, dotted paths ("business.hours.mon", trailing "[]" for lists)
 * Outputs: PROFILE_GROUPS, getPath / setPath / confirmPath / confirmGroup
 * Used by: Brain editor + draft review components (client-safe — no server imports)
 */
import type { BrandProfileData } from "./types";

export type FieldKind = "text" | "textarea" | "list" | "hex" | "hours" | "audiences" | "ctas";
export type FieldDef = { path: string; label: string; kind: FieldKind };
export type GroupDef = { key: string; label: string; fields: FieldDef[] };

export const HOURS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const PROFILE_GROUPS: GroupDef[] = [
  {
    key: "business",
    label: "Business",
    fields: [
      { path: "business.name", label: "Name", kind: "text" },
      { path: "business.tagline", label: "Tagline", kind: "text" },
      { path: "business.description", label: "Description", kind: "textarea" },
      { path: "business.category", label: "Category", kind: "text" },
      { path: "business.founded", label: "Founded", kind: "text" },
      { path: "business.languages[]", label: "Languages", kind: "list" },
      { path: "business.contact.phone", label: "Phone", kind: "text" },
      { path: "business.contact.email", label: "Email", kind: "text" },
      { path: "business.contact.address", label: "Address", kind: "text" },
      { path: "business.contact.website", label: "Website", kind: "text" },
      ...HOURS_DAYS.map((d) => ({ path: `business.hours.${d}`, label: `Hours ${d}`, kind: "text" as const })),
      { path: "business.service_areas[]", label: "Service areas", kind: "list" },
    ],
  },
  {
    key: "voice",
    label: "Voice",
    fields: [
      { path: "voice.tone[]", label: "Tone", kind: "list" },
      { path: "voice.style_notes", label: "Style notes", kind: "textarea" },
      { path: "voice.do[]", label: "Do", kind: "list" },
      { path: "voice.dont[]", label: "Do not", kind: "list" },
      { path: "voice.sample_lines[]", label: "Sample lines", kind: "list" },
    ],
  },
  {
    key: "visuals",
    label: "Visuals",
    fields: [
      { path: "visuals.colors.primary", label: "Primary colour", kind: "hex" },
      { path: "visuals.colors.accent", label: "Accent colour", kind: "hex" },
      { path: "visuals.colors.background", label: "Background colour", kind: "hex" },
      { path: "visuals.colors.text", label: "Text colour", kind: "hex" },
      { path: "visuals.fonts.heading", label: "Heading font", kind: "text" },
      { path: "visuals.fonts.body", label: "Body font", kind: "text" },
    ],
  },
  { key: "audiences", label: "Audiences", fields: [{ path: "audiences[]", label: "Audiences", kind: "audiences" }] },
  {
    key: "claims",
    label: "Claims",
    fields: [
      { path: "claims.allowed[]", label: "Allowed claims", kind: "list" },
      { path: "claims.forbidden[]", label: "Forbidden claims", kind: "list" },
    ],
  },
  { key: "ctas", label: "Calls to action", fields: [{ path: "ctas[]", label: "CTAs", kind: "ctas" }] },
  {
    key: "social",
    label: "Social",
    fields: (["facebook", "instagram", "tiktok", "youtube", "linkedin"] as const).map((n) => ({
      path: `social.${n}`,
      label: n[0].toUpperCase() + n.slice(1),
      kind: "text" as const,
    })),
  },
];

const BAD = new Set(["__proto__", "constructor", "prototype"]);

function segments(path: string): string[] {
  const segs = (path.endsWith("[]") ? path.slice(0, -2) : path).split(".");
  for (const s of segs) if (!s || BAD.has(s)) throw new Error(`invalid path segment in "${path}"`);
  return segs;
}

type Obj = Record<string, unknown>;

export function getPath(data: BrandProfileData, path: string): unknown {
  let cur: unknown = data;
  for (const seg of segments(path)) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Obj)[seg];
  }
  return cur;
}

export function setPath(data: BrandProfileData, path: string, value: unknown): BrandProfileData {
  const segs = segments(path);
  const root = structuredClone(data) as unknown as Obj;
  let cur = root;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (typeof next !== "object" || next === null) throw new Error(`path not in profile shape: "${path}"`);
    cur = next as Obj;
  }
  cur[segs[segs.length - 1]] = value;
  return root as unknown as BrandProfileData;
}

function withConfirmed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withConfirmed);
  if (typeof v === "object" && v !== null && "source" in v) return { ...(v as Obj), confirmed: true };
  return v;
}

export function confirmPath(data: BrandProfileData, path: string): BrandProfileData {
  const cur = getPath(data, path);
  return cur === undefined || cur === null ? data : setPath(data, path, withConfirmed(cur));
}

export function confirmGroup(data: BrandProfileData, groupKey: string): BrandProfileData {
  const group = PROFILE_GROUPS.find((g) => g.key === groupKey);
  if (!group) throw new Error(`unknown group "${groupKey}"`);
  return group.fields.reduce((d, f) => confirmPath(d, f.path), data);
}
