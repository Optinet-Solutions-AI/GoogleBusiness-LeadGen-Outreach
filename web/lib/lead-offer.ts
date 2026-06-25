/**
 * lead-offer.ts — Which build/offer surface a lead gets on the dashboard. Pure.
 *
 * Inputs:  { segment, buildable }
 * Outputs: BuildSurface — drives the Build/Improve vs AI-services UI
 * Used by: components/LeadActions.tsx, components/NextStepPill.tsx
 *
 * Per the offer strategy (see CLAUDE.md + lib/segment.ts):
 *   no_website  → BUILD a website (focus niche only; else off_niche)
 *   old_website → BUILD/IMPROVE a modern rebuild (focus niche only)
 *   has_website → AI SERVICES (booking / receptionist), NEVER a website —
 *                 so we hide the Build/Improve surface regardless of niche.
 */

import type { CallSegment } from "./segment";

export type BuildSurface =
  | "build" // show Build (+ Improve/Rebuild) — no_website / old_website in a focus niche
  | "ai_services" // healthy site → pitch AI services, never a website
  | "off_niche"; // build-eligible segment but niche isn't one of the 5 focus templates

export function buildSurfaceFor(opts: {
  segment: CallSegment;
  buildable: boolean;
}): BuildSurface {
  // A healthy existing site is never offered a website — pitch AI services.
  // This wins over niche: even a focus-niche restaurant with a great site
  // should not see "Build website".
  if (opts.segment === "has_website") return "ai_services";
  // no_website / old_website: buildable only if the niche has a focus template.
  return opts.buildable ? "build" : "off_niche";
}
