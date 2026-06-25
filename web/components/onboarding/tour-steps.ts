/**
 * onboarding/tour-steps.ts — static step config for the first-time guided tour.
 *
 * Inputs:  none (static).
 * Outputs: ordered TOUR_STEPS array — one source of truth for what the spotlight
 *          highlights and the copy shown at each step.
 * Used by: components/onboarding/OnboardingTour.tsx
 *
 * Each step either targets a real element by `data-tour` selector (spotlight) or
 * has no target (centered card — welcome / closing / mobile fallback).
 */

export type Placement = "center" | "right" | "bottom";

export interface TourStep {
  key: string;
  /** CSS selector of the element to spotlight; omit for a centered card. */
  target?: string;
  title: string;
  body: string;
  placement: Placement;
}

export const TOUR_STEPS: TourStep[] = [
  {
    key: "welcome",
    title: "Welcome to RateUp 👋",
    body: "This is your lead-gen control room — scrape local businesses, build them a demo site, and run the email sequence that closes them. Here's a 5-stop tour. Takes about 30 seconds.",
    placement: "center",
  },
  {
    key: "today",
    target: '[data-tour="needs-you"]',
    title: "Today — your mission control",
    body: "Start here every day. The “Needs you” card surfaces everything waiting on a decision: replies to triage, leads missing an email, meetings to confirm.",
    placement: "right",
  },
  {
    key: "batches",
    target: '[data-tour="nav-batches"]',
    title: "Batches — find leads",
    body: "Pick a niche + city and run a batch. It scrapes Google Maps for local businesses and lands them here for you to review before any money is spent.",
    placement: "right",
  },
  {
    key: "leads",
    target: '[data-tour="nav-leads"]',
    title: "Leads — review & build",
    body: "Every scraped business lives here. Click “Build” on a lead to auto-generate a personalized demo site, deploy it, and capture a screenshot — all in one step.",
    placement: "right",
  },
  {
    key: "campaigns",
    target: '[data-tour="nav-campaigns"]',
    title: "Outreach — enroll & reply",
    body: "Enroll a built lead into the screenshot-first email sequence, then watch the Inbox for replies. A reply, bounce, or unsubscribe automatically stops the follow-ups.",
    placement: "right",
  },
  {
    key: "resources",
    target: '[data-tour="resources"]',
    title: "Help is always here",
    body: "The full user manual and API docs live down here. You can replay this tour any time with “Take the tour” in this section.",
    placement: "right",
  },
  {
    key: "done",
    title: "You're all set 🚀",
    body: "That's the loop: scrape → build → email → close. Jump into Batches when you're ready to run your first one.",
    placement: "center",
  },
];
