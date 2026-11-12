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
    body: "This is your lead-gen control room. In about a minute I'll walk you through the whole loop: scrape local businesses → build them a demo site → email them → close. Let's go.",
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
    key: "scrape",
    target: '[data-tour="new-batch"]',
    title: "Step 1 — Scrape leads",
    body: "Click “New batch”. First choose what you’re looking for (local businesses, closing businesses, or conference exhibitors), then the niche, city and a limit — and hit Find leads. It costs a little, so you review the results before spending more.",
    placement: "bottom",
  },
  {
    key: "batches",
    target: '[data-tour="nav-batches"]',
    title: "Batches — what you've submitted",
    body: "Every scrape you run shows up here, grouped by batch, with its status and cost. Open a batch to see the businesses it found.",
    placement: "right",
  },
  {
    key: "leads",
    target: '[data-tour="nav-leads"]',
    title: "Leads — review everything",
    body: "Every business lands in Leads with its contact details — email (and whether it’s ready to send), phone, owner. Each row has three buttons: Send email, Call with AI, Find contacts (AI). Send email and Call with AI show you a preview first, so you see the exact email (and can edit it) or what the AI caller will know, before anything goes out. Each lead is also auto-classified into a segment that tells you the right offer (next slide).",
    placement: "right",
  },
  {
    key: "segments",
    title: "Segments decide the offer",
    body: "Three segments, three pitches:  •  No website → build them a demo site.  •  Weak / outdated site → pitch a modern rebuild.  •  Healthy site already → don't pitch a website; offer AI services instead (booking, receptionist, chat). Matching the offer to the segment is what makes outreach land.",
    placement: "center",
  },
  {
    key: "build",
    title: "Step 2 — Build a demo site",
    body: "On a lead that needs a site, click “Build”. RateUp auto-generates a personalized demo, deploys it to a live URL, and captures a screenshot — about a minute, ~$0.05. No design work from you.",
    placement: "center",
  },
  {
    key: "outreach",
    target: '[data-tour="nav-campaigns"]',
    title: "Step 3 — Submit outreach",
    body: "Enroll a built lead to start the screenshot-first email sequence (plain text → screenshot → live link → soft close). No demo yet? You can still send: it offers them a free sample site instead (2 emails). Replies, bounces, and unsubscribes stop it automatically. Watch the Inbox for responses to triage.",
    placement: "right",
  },
  {
    key: "resources",
    target: '[data-tour="resources"]',
    title: "Help is always here",
    body: "The full user manual and API docs live in the menu. You can replay this tour any time with “Take the tour” in Resources.",
    placement: "right",
  },
  {
    key: "assistant",
    title: "Stuck? Click “Ask how”",
    body: "The “Ask how” button (bottom-right, on every page) is an assistant that knows this app. Type or speak your question in English or Hebrew — click the mic and allow it once (“Allow on every visit”). It answers in English with the exact steps and links. It only answers questions about this app.",
    placement: "center",
  },
  {
    key: "done",
    title: "You're all set 🚀",
    body: "That's the loop: scrape → build → email → close. Start with Step 1 — run your first batch from “New batch”.",
    placement: "center",
  },
];
