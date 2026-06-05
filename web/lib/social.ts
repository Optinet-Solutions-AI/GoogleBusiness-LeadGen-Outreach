/**
 * social.ts — labels + helpers for social-page leads (DM channel).
 *
 * A no-website lead is classified by website_kind (facebook/instagram/…). These
 * helpers turn that into a human label + a yes/no "is this a social page".
 * Client-safe (pure) — used by the assisted-DM panel, the inbox, and the lead page.
 */

import { SOCIAL_KINDS } from "@/lib/campaigns/eligibility";

export const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
  other_social: "social page",
};

export function isSocialKind(kind: string | null | undefined): boolean {
  return !!kind && SOCIAL_KINDS.includes(kind);
}

export function socialLabel(kind: string | null | undefined): string {
  return (kind && SOCIAL_LABELS[kind]) || "social";
}
