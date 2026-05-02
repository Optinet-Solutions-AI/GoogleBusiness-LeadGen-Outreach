/**
 * LeadBadges.tsx — Detection-flag badges for a lead row.
 *
 * Inputs:  lead detection fields (website_kind, business_status, is_service_area_only, ...)
 * Outputs: 0..N small colored badges, optionally clickable
 * Used by: dashboard leads list, batch detail, lead detail
 *
 * Badges DO NOT change qualified status — they're informational so the
 * operator can sort/filter without losing rows. Per the detect-don't-reject
 * policy, only CLOSED_PERMANENTLY hard-rejects (and rejected leads don't
 * render in the main lead list anyway).
 */

import type { ReactNode } from "react";

export type WebsiteKind =
  | "none"
  | "real"
  | "facebook"
  | "instagram"
  | "twitter"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "yelp"
  | "yellowpages"
  | "foursquare"
  | "nextdoor"
  | "thumbtack"
  | "angi"
  | "bbb"
  | "linktree"
  | "beacons"
  | "about_me"
  | "carrd"
  | "sites_google"
  | "wix_free"
  | "weebly"
  | "webnode"
  | "blogspot"
  | "wordpress"
  | "other_social"
  | "other_aggregator"
  | "other_free_host";

interface LeadDetectionFields {
  website_kind?: WebsiteKind | null;
  website_url?: string | null;
  business_status?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
  is_service_area_only?: boolean | null;
  is_franchise_flagged?: boolean | null;
  language_code?: string | null;
  /** Operator's expected language for outreach. Defaults to 'en'. */
  expected_language?: string;
}

const SOCIAL_LABELS: Partial<Record<WebsiteKind, string>> = {
  facebook: "Facebook only",
  instagram: "Instagram only",
  twitter: "X / Twitter",
  linkedin: "LinkedIn only",
  tiktok: "TikTok only",
  pinterest: "Pinterest only",
  youtube: "YouTube only",
  yelp: "Yelp only",
  yellowpages: "Yellow Pages only",
  foursquare: "Foursquare",
  nextdoor: "Nextdoor",
  thumbtack: "Thumbtack",
  angi: "Angi",
  bbb: "BBB",
  linktree: "Linktree",
  beacons: "Beacons",
  about_me: "About.me",
  carrd: "Carrd",
  sites_google: "Google Sites",
  wix_free: "Free Wix subdomain",
  weebly: "Weebly subdomain",
  webnode: "Webnode",
  blogspot: "Blogspot",
  wordpress: "WordPress.com",
  other_social: "Other social",
  other_aggregator: "Listing site",
  other_free_host: "Free site host",
};

export function LeadBadges({ lead }: { lead: LeadDetectionFields }) {
  const badges: ReactNode[] = [];

  // Website-kind badge (social / aggregator / free-host = soft warning).
  if (lead.website_kind && lead.website_kind !== "none" && lead.website_kind !== "real") {
    const label = SOCIAL_LABELS[lead.website_kind] ?? "Social profile only";
    badges.push(
      <Badge
        key="website-kind"
        tone="info"
        href={lead.website_url ?? undefined}
        title={lead.website_url ?? undefined}
      >
        {label}
      </Badge>,
    );
  } else if (lead.website_kind === "none") {
    badges.push(
      <Badge key="no-online" tone="success" title="No website, no socials — best target">
        No online presence
      </Badge>,
    );
  }

  // Closed temporarily (flag, not reject).
  if (lead.business_status === "CLOSED_TEMPORARILY") {
    badges.push(
      <Badge key="closed-temp" tone="warning" title="Google flagged as closed temporarily">
        Closed temporarily
      </Badge>,
    );
  }

  // Service-area / mobile-only.
  if (lead.is_service_area_only) {
    badges.push(
      <Badge key="mobile" tone="info" title="No fixed address — mobile / service-area business">
        Mobile / SAB
      </Badge>,
    );
  }

  // Franchise flag.
  if (lead.is_franchise_flagged) {
    badges.push(
      <Badge key="franchise" tone="warning" title="Looks like a franchise / chain location">
        Franchise
      </Badge>,
    );
  }

  // Language mismatch.
  if (
    lead.language_code &&
    lead.language_code !== (lead.expected_language ?? "en")
  ) {
    badges.push(
      <Badge key="lang" tone="warning" title={`Detected language: ${lead.language_code}`}>
        Lang: {lead.language_code.toUpperCase()}
      </Badge>,
    );
  }

  if (badges.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1">{badges}</div>;
}

const TONE_CLASSES = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  info: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100",
  warning: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
  neutral: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
} as const;

type Tone = keyof typeof TONE_CLASSES;

function Badge({
  children,
  tone,
  href,
  title,
}: {
  children: ReactNode;
  tone: Tone;
  href?: string;
  title?: string;
}) {
  const cls = `inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border leading-tight transition-colors ${TONE_CLASSES[tone]}`;
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cls}
        title={title}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  }
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
