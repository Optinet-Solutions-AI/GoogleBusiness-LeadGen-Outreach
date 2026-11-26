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
  // Closure-signal, exhibitor and review-site leads are never built for (inventory / booth / reputation offers instead).
  if (opts.segment === "liquidation" || opts.segment === "exhibitor" || opts.segment === "reputation") return "off_niche";
  // Every other lead can be built on demand: a dedicated niche template when there is one, the
  // general template otherwise. A healthy existing site is still *pitched* AI services by the
  // automated outreach, but the operator may build a demo for it (`buildable` is informational).
  return "build";
}

/** Stages past "deployed": a lead already contacted (or further). A build must not move these back. */
const PAST_DEPLOYED = new Set(["outreached", "replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won", "closed_lost", "dead"]);

/**
 * Build website shows on every normal lead that has no demo yet, at any stage (operator, 26 Nov 2026: a lead that
 * was already emailed or replied can still get its sample site). Never for closing-business / exhibitor /
 * review-site leads (surface off_niche).
 */
export function canBuildWebsite(o: { stage: string; demoUrl: string | null; surface: BuildSurface }): boolean {
  return o.surface === "build" && !o.demoUrl;
}

/**
 * The stage to put back after a build: the build's own steps write enriched → generated → deployed, which would move
 * an already-contacted lead backwards (out of its CRM column). Null = a new lead: "deployed" stands.
 */
export function stageToKeepAfterBuild(startStage: string | null | undefined): string | null {
  return startStage && PAST_DEPLOYED.has(startStage) ? startStage : null;
}
