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
 *   liquidation → never built for (we buy inventory) → off_niche (no Build).
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
  // Closure-signal and exhibitor leads are never built for (inventory / booth offers instead).
  if (opts.segment === "liquidation" || opts.segment === "exhibitor") return "off_niche";
  // Every other lead can be built on demand: a dedicated niche template when there is one, the
  // general template otherwise. A healthy existing site is still *pitched* AI services by the
  // automated outreach, but the operator may build a demo for it (`buildable` is informational).
  return "build";
}
