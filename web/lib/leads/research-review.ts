/**
 * leads/research-review.ts — "AI Lookup" results as reviewable lines, and the swap rules. Pure.
 *
 * Inputs:  the saved research (leads.ai_profile, incl. the operator's decisions) + the lead's current contact fields
 * Outputs: reviewRows → one line per finding with its state (in use / verified / new), removed ones left out;
 *          swapIn → the extra-contacts list after a new main email / phone is chosen (the old one is kept)
 * Used by: components/leads/ResearchPanel.tsx, components/leads/ContactCard.tsx, lib/leads/research-decide.ts
 *
 * Verify on an email / phone / owner / contact page = "use it": it becomes the lead's main value and the previous
 * one moves to the extra list (never deleted). Verify on any other detail just marks it checked. Remove hides it.
 */
import type { ProfileView } from "./ai-profile-view";

export type Decision = "verified" | "removed";
export type ResearchView = ProfileView & { decisions?: Record<string, Decision> | null };
export type ReviewKind = "email" | "phone" | "owner" | "contact_page" | "detail";
export type ReviewState = "in_use" | "verified" | "new";

export interface ReviewRow {
  key: string;
  kind: ReviewKind;
  label: string;
  /** What "use it" writes (email / phone / URL / owner name). */
  value: string;
  text?: string;
  links?: { label: string; url: string }[];
  state: ReviewState;
}

export interface CurrentContact {
  email: string | null;
  phone: string | null;
  contact_owner_name: string | null;
  contact_page_url: string | null;
}

export interface OtherContact {
  value: string;
  source: "replaced" | "research" | string;
  added_at: string;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const sameUrl = (a: string | null | undefined, b: string | null | undefined) =>
  lower(a).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") === lower(b).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Phones match on their last 9 digits, so "+1 512 555 0123" and "(512) 555-0123" are the same number. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  return !!x && !!y && x.slice(-9) === y.slice(-9);
}

export function reviewRows(p: ResearchView, lead: CurrentContact): ReviewRow[] {
  const d = p.decisions ?? {};
  const rows: ReviewRow[] = [];
  const push = (r: Omit<ReviewRow, "state">, inUse: boolean) => {
    if (d[r.key] === "removed") return;
    rows.push({ ...r, state: inUse ? "in_use" : d[r.key] === "verified" ? "verified" : "new" });
  };
  const detail = (key: string, label: string, text: string | null | undefined) => {
    if (text && text.trim()) push({ key, kind: "detail", label, value: text.trim(), text: text.trim() }, false);
  };

  for (const e of p.emails) push({ key: `email:${lower(e)}`, kind: "email", label: "Email", value: e, text: e }, lower(e) === lower(lead.email));
  for (const ph of p.phones) push({ key: `phone:${digits(ph)}`, kind: "phone", label: "Phone", value: ph, text: ph }, samePhone(ph, lead.phone));
  if (p.owner_name) {
    push(
      { key: "owner", kind: "owner", label: "Owner", value: p.owner_name, text: p.owner_role ? `${p.owner_name} (${p.owner_role})` : p.owner_name },
      lower(p.owner_name) === lower(lead.contact_owner_name),
    );
  }
  if (p.contact_url) {
    push(
      { key: "contact_url", kind: "contact_page", label: "Contact page", value: p.contact_url, links: [{ label: "Open", url: p.contact_url }] },
      sameUrl(p.contact_url, lead.contact_page_url),
    );
  }
  detail("what_they_do", "What they do", p.what_they_do);
  detail("people", "Other people", p.people.map((x) => (x.role ? `${x.name} (${x.role})` : x.name)).join(", "));
  if (p.website) {
    push({ key: "website", kind: "detail", label: "Website", value: p.website, links: [{ label: p.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), url: p.website }] }, false);
  }
  detail("address", "Address", p.address);
  detail("hours", "Hours", p.hours);
  if (p.socials.length) {
    push({ key: "socials", kind: "detail", label: "Social", value: p.socials.map((s) => s.url).join(" "), links: p.socials.map((s) => ({ label: s.platform, url: s.url })) }, false);
  }
  detail("services", "Services", p.services.join(", "));
  detail("founded", "Founded", p.founded);
  detail("size", "Size", p.size);
  detail("reviews", "Reviews", p.reviews);
  return rows;
}

/**
 * The extra-contacts list after `next` becomes the main value: the old main one goes on top (if any and different),
 * `next` leaves the list, duplicates are dropped, newest first, at most 10.
 */
export function swapIn(
  list: OtherContact[] | null | undefined,
  oldMain: string | null,
  next: string,
  same: (a: string, b: string) => boolean,
  now = new Date().toISOString(),
): OtherContact[] {
  const out: OtherContact[] = [];
  if (oldMain && oldMain.trim() && !same(oldMain, next)) out.push({ value: oldMain.trim(), source: "replaced", added_at: now });
  for (const o of list ?? []) {
    if (!o?.value || same(o.value, next) || out.some((x) => same(x.value, o.value))) continue;
    out.push(o);
  }
  return out.slice(0, 10);
}

export const sameEmailValue = (a: string, b: string) => lower(a) === lower(b);
