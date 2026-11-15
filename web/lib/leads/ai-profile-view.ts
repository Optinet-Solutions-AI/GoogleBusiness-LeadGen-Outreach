/**
 * leads/ai-profile-view.ts — turn an AI profile into the bullet list the AI profile window shows. Pure.
 *
 * Inputs:  an AiProfile-shaped object (as returned by POST/GET /api/leads/:id/ai-profile)
 * Outputs: [{ label, text?, links? }] in a fixed order, only the rows that have something
 * Used by: components/leads/AiProfileModal.tsx, lib/leads/ai-profile.ts (the CRM note), ai-profile-view.test.ts
 */

export interface ProfileView {
  summary: string | null;
  what_they_do: string | null;
  owner_name: string | null;
  owner_role: string | null;
  people: { name: string; role: string | null }[];
  emails: string[];
  phones: string[];
  website: string | null;
  contact_url: string | null;
  address: string | null;
  hours: string | null;
  socials: { platform: string; url: string }[];
  services: string[];
  founded: string | null;
  size: string | null;
  reviews: string | null;
  sources: string[];
}

export interface ProfileBullet {
  label: string;
  text?: string;
  links?: { label: string; url: string }[];
}

const person = (name: string, role: string | null) => (role ? `${name} (${role})` : name);

export function profileBullets(p: ProfileView): ProfileBullet[] {
  const out: ProfileBullet[] = [];
  const add = (label: string, text: string | null | undefined) => {
    if (text && text.trim()) out.push({ label, text: text.trim() });
  };
  add("What they do", p.what_they_do);
  add("Owner", p.owner_name ? person(p.owner_name, p.owner_role) : null);
  add("Other people", p.people.length ? p.people.map((x) => person(x.name, x.role)).join(", ") : null);
  add("Email", p.emails.join(", "));
  add("Phone", p.phones.join(", "));
  if (p.website) out.push({ label: "Website", links: [{ label: p.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), url: p.website }] });
  if (p.contact_url) out.push({ label: "Contact page", links: [{ label: "Open", url: p.contact_url }] });
  add("Address", p.address);
  add("Hours", p.hours);
  if (p.socials.length) out.push({ label: "Social", links: p.socials.map((s) => ({ label: s.platform, url: s.url })) });
  add("Services", p.services.join(", "));
  add("Founded", p.founded);
  add("Size", p.size);
  add("Reviews", p.reviews);
  return out;
}

/** Plain-text version for the CRM timeline note. */
export function profileNote(p: ProfileView): string {
  const lines = profileBullets(p).map((b) => `• ${b.label}: ${b.text ?? (b.links ?? []).map((l) => l.url).join(", ")}`);
  return [`AI profile${p.summary ? `: ${p.summary}` : ""}`, ...lines].join("\n").slice(0, 4000);
}
