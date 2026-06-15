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
 *
 * Client component — the inner Badge uses onClick to stopPropagation so a
 * badge click doesn't also trigger the surrounding row-link navigation.
 */
"use client";

import type { ReactNode } from "react";
import { deriveSegment, CALL_SEGMENTS, type CallSegment } from "@/lib/segment";

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
  category_off_niche?: boolean | null;
  language_code?: string | null;
  /** Operator's expected language for outreach. Defaults to 'en'. */
  expected_language?: string;
  /** Offer routing (migration 016). */
  primary_offer?: "build_website" | "improve_website" | "voice_agent" | null;
  needs_improvement?: boolean | null;
  website_score?: number | null;
  /** Stored call segment (operator-overridable); when null, derived from website signals. */
  call_segment?: string | null;
}

const OFFER_BADGE: Record<string, { label: string; tone: Tone }> = {
  build_website: { label: "Build", tone: "success" },
  improve_website: { label: "Improve", tone: "warning" },
};

const SEGMENT_BADGE: Record<CallSegment, { label: string; tone: Tone }> = {
  no_website: { label: "No website", tone: "success" },
  old_website: { label: "Old website", tone: "warning" },
  has_website: { label: "Has website", tone: "neutral" },
};

const SOCIAL_LABELS: Partial<Record<WebsiteKind, string>> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
  yelp: "Yelp",
  yellowpages: "Yellow Pages",
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

  // Predetermined segment — the lead's headline classification. Prefer the stored
  // call_segment (respects manual overrides); fall back to deriving from website
  // signals when it isn't set yet. (Replaces the old Email / DM-SMS channel tag,
  // which showed on every real-website lead regardless of whether an address existed.)
  const segment: CallSegment =
    lead.call_segment && (CALL_SEGMENTS as readonly string[]).includes(lead.call_segment)
      ? (lead.call_segment as CallSegment)
      : deriveSegment({
          has_website: lead.website_kind === "real",
          needs_improvement: lead.needs_improvement ?? null,
        });
  const seg = SEGMENT_BADGE[segment];
  badges.push(
    <Badge key="segment" tone={seg.tone} title={`Segment: ${seg.label}`}>
      {seg.label}
    </Badge>,
  );

  // Offer badge — which of the 3 offers this lead is routed to. Leads first.
  if (lead.primary_offer && OFFER_BADGE[lead.primary_offer]) {
    const { label, tone } = OFFER_BADGE[lead.primary_offer];
    const title =
      lead.primary_offer === "improve_website" && typeof lead.website_score === "number"
        ? `Website health ${lead.website_score}/100 — needs improvement`
        : `Routed offer: ${label}`;
    badges.push(
      <Badge key="offer" tone={tone} title={title}>
        {label}
      </Badge>,
    );
  }

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

  // Category off-niche flag (kept, not rejected — operator should eyeball it).
  if (lead.category_off_niche) {
    badges.push(
      <Badge key="cat-off" tone="warning" title="Google's category didn't match the searched niche — review relevance">
        Category?
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
  success: "bg-positive-soft text-positive border-positive/30 hover:bg-positive/15",
  info:    "bg-action-soft text-action border-action/30 hover:bg-action/15",
  warning: "bg-warning-soft text-warning border-warning/30 hover:bg-warning/15",
  neutral: "bg-surface-alt text-ink-muted border-rule hover:bg-surface-alt/80",
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
