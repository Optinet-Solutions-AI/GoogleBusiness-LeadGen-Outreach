/**
 * leads/email-site.ts — is the lead's email on its website's domain? (warning on the Contact card)
 *
 * Inputs:  the lead's main email and website
 * Outputs: emailSiteMismatch(email, website) → { emailDomain, siteDomain } when they differ, else null
 * Used by: components/leads/ContactCard.tsx
 *
 * QA 23 Nov 2026: a locksmith carried its web partner's address (…@dancogroupal.com) and a plumber its web host's
 * staging address (…@…sg-host.com). A free mailbox (Gmail, Yahoo…) is normal for a small business, so no warning;
 * nor when the "website" is a social page. Pure, safe in client components.
 */
import { classifyWebsite } from "@/lib/filters";

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net", "verizon.net",
  "cox.net", "charter.net", "earthlink.net",
]);

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const related = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

export function emailSiteMismatch(
  email: string | null | undefined,
  website: string | null | undefined,
): { emailDomain: string; siteDomain: string } | null {
  if (!email || !website) return null;
  const emailDomain = bare(email.trim().split("@")[1] ?? "");
  if (!emailDomain || FREE_MAIL.has(emailDomain)) return null;
  const url = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
  if (classifyWebsite(url) !== "real") return null;
  let siteDomain: string;
  try {
    siteDomain = bare(new URL(url).hostname);
  } catch {
    return null;
  }
  return related(emailDomain, siteDomain) ? null : { emailDomain, siteDomain };
}
