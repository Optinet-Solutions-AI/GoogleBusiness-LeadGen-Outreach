"use client";

/**
 * NextStepPill.tsx — stage-aware "what to do next" banner on the lead page.
 *
 * Inputs:  lead { id, stage, demo_url, email, custom_domain }
 * Outputs: dark editorial banner at top of /leads/[id] with:
 *          - eyebrow telling the operator what stage they're at
 *          - serif headline phrased as a directive ("Triage the reply")
 *          - 1 primary CTA + 1-2 alternates relevant to this stage
 *          - subtle ember live-dot when the lead is hot
 * Used by: app/(dashboard)/leads/[id]/page.tsx (top of the page)
 *
 * The pill never duplicates an action — clicking "Mark meeting booked"
 * here calls the same /api/leads/:id/meeting endpoint LeadActions uses.
 * Both surfaces stay in sync via router.refresh() after the mutation.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Mail,
  Calendar,
  CheckCircle2,
  Building,
  Sparkles,
  XCircle,
  Hammer,
  ArrowRight,
} from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { buildSurfaceFor } from "@/lib/lead-offer";
import type { CallSegment } from "@/lib/segment";

interface Lead {
  id: string;
  stage: string;
  email: string | null;
  demo_url: string | null;
  custom_domain: string | null;
}

interface Action {
  label: string;
  variant: "primary" | "secondary" | "danger";
  icon: typeof Send;
  onClick: () => Promise<void> | void;
}

interface PillCopy {
  eyebrowStage: string;
  headline: string;
  caption: string;
  live?: boolean;
  actions: Action[];
}

export function NextStepPill({
  lead,
  buildable,
  segment,
}: {
  lead: Lead;
  buildable: boolean;
  segment: CallSegment;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function patch(payload: Record<string, unknown>) {
    const res = await fetchJson(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.success) toast.error(res.error);
  }

  async function postMeeting(status: "booked" | "done") {
    const res = await fetchJson(`/api/leads/${lead.id}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.success) toast.error(res.error);
  }

  async function buildSite() {
    const res = await fetchJson(`/api/leads/${lead.id}/build`, { method: "POST" });
    if (!res.success) toast.error(res.error);
  }

  async function sendOutreach() {
    if (!lead.email) {
      toast.warning("Add an email first.");
      return;
    }
    const res = await fetchJson(`/api/leads/${lead.id}/outreach`, { method: "POST" });
    if (!res.success) toast.error(res.error);
  }

  const surface = buildSurfaceFor({ segment, buildable });
  const copy = pillCopyFor(lead, surface, {
    setStage: (s) => run(`Mark ${s}`, () => patch({ stage: s })),
    bookMeeting: () => run("Mark booked", () => postMeeting("booked")),
    doneMeeting: () => run("Mark done", () => postMeeting("done")),
    build: () => run("Build", buildSite),
    outreach: () => run("Send", sendOutreach),
    // Cross-component dispatch: LeadActions on the right rail listens and
    // toggles its email-edit mode / opens the corresponding modal. Scroll
    // happens inside LeadActions once the target is rendered.
    scrollToEmail: () => {
      window.dispatchEvent(new CustomEvent("lead-actions:edit-email"));
    },
    scrollToImprove: () => {
      window.dispatchEvent(new CustomEvent("lead-actions:open-improve"));
    },
    scrollToHandover: () => {
      window.dispatchEvent(new CustomEvent("lead-actions:open-handover"));
    },
  });

  if (!copy) return null;

  return (
    <section
      className="relative bg-ink text-canvas rounded-lg shadow-hero overflow-hidden mb-6"
      aria-label="Next step"
    >
      {/* Subtle grain */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-screen opacity-[0.06]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          backgroundSize: "200px 200px",
        }}
        aria-hidden
      />

      <div className="relative px-6 py-5 flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="eyebrow text-canvas">Next step</span>
            <span className="eyebrow text-canvas/40">·</span>
            <span className="eyebrow text-canvas/55">{copy.eyebrowStage}</span>
            {copy.live && <span className="live-dot ml-1" aria-hidden />}
          </div>
          <h2 className="editorial-head text-canvas text-2xl md:text-[28px] leading-tight">
            {copy.headline}
          </h2>
          <p className="text-[12.5px] text-canvas/60 mt-1.5 leading-relaxed">{copy.caption}</p>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 lg:flex-shrink-0">
          {copy.actions.map((a) => (
            <ActionBtn key={a.label} action={a} busy={busy === a.label} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ActionBtn({ action, busy }: { action: Action; busy: boolean }) {
  const base = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-[12.5px] font-semibold transition-all whitespace-nowrap disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-canvas text-ink hover:bg-canvas/90",
    secondary: "bg-white/10 text-canvas border border-white/20 hover:bg-white/15",
    danger: "bg-transparent text-canvas/55 border border-white/15 hover:bg-white/5 hover:text-canvas/85",
  };
  const Icon = action.icon;
  return (
    <button onClick={action.onClick} disabled={busy} className={`${base} ${variants[action.variant]}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {busy ? "Working…" : action.label}
    </button>
  );
}

/**
 * Per-stage copy + actions. Each stage maps to ONE primary directive + 1-2 alts.
 * Returning null means "no specific next step" (terminal stages like closed_won).
 */
function pillCopyFor(lead: Lead, surface: "build" | "ai_services" | "off_niche", h: {
  setStage: (s: string) => void;
  bookMeeting: () => void;
  doneMeeting: () => void;
  build: () => void;
  outreach: () => void;
  scrollToEmail: () => void;
  scrollToImprove: () => void;
  scrollToHandover: () => void;
}): PillCopy | null {
  const earlyStage = ["scraped", "enriched", "generated"].includes(lead.stage);
  // Healthy existing site → pitch AI services, never a website. Replace the
  // early-stage "Build website" directive so the pill doesn't dangle a CTA
  // that contradicts the offer.
  if (earlyStage && surface === "ai_services") {
    return {
      eyebrowStage: lead.stage,
      headline: lead.email ? "Pitch AI services — enroll in the sequence." : "Pitch AI services — add an email first.",
      caption:
        "This business has a healthy website, so there's no site to build. Route it to AI services (an AI receptionist / booking assistant): " +
        (lead.email
          ? "enroll it in the email sequence on the right — it sends the AI-services pitch, no demo needed."
          : "add a verified email, then enroll it in the email sequence on the right.") +
        " Flip the segment if the site is actually weak or missing.",
      actions: lead.email
        ? [
            { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
          ]
        : [
            { label: "Add an email", variant: "primary", icon: Mail, onClick: h.scrollToEmail },
            { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
          ],
    };
  }
  // Off-list niches never build a demo site — outreach-only message so the pill
  // doesn't dangle a "Build website" CTA the gate would just refuse.
  if (earlyStage && surface === "off_niche") {
    return {
      eyebrowStage: lead.stage,
      headline: "No demo site for this niche.",
      caption:
        "The website builder covers Trades, Dental, Chiropractic, Restaurants & Auto Shops. This lead stays available for outreach.",
      actions: [
        { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
      ],
    };
  }
  switch (lead.stage) {
    case "scraped":
    case "enriched":
    case "generated":
      return {
        eyebrowStage: lead.stage,
        headline: "Build this lead's demo site.",
        caption: "Runs enrich → generate → deploy. Doesn't send anything yet — that's a separate step.",
        actions: [
          { label: "Build website", variant: "primary", icon: Hammer, onClick: h.build },
          { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
        ],
      };

    case "deployed":
      return {
        eyebrowStage: "deployed · ready to send",
        headline: lead.email ? "Send the demo to their email." : "Add an email so we can reach out.",
        caption: lead.email
          ? `Outreach will go to ${lead.email} via Instantly with the demo URL.`
          : "We don't have an email for this lead yet. Add one from their Google listing or website footer.",
        actions: lead.email
          ? [
              { label: "Send outreach", variant: "primary", icon: Send, onClick: h.outreach },
              { label: "Edit email", variant: "secondary", icon: Mail, onClick: h.scrollToEmail },
            ]
          : [
              { label: "Add an email", variant: "primary", icon: Mail, onClick: h.scrollToEmail },
              { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
            ],
      };

    case "needs_email":
      return {
        eyebrowStage: "needs email",
        headline: "Add an email address.",
        caption: "Outreach is blocked until we have one. Check their Google listing, website footer, or LinkedIn.",
        actions: [
          { label: "Add email", variant: "primary", icon: Mail, onClick: h.scrollToEmail },
          { label: "Skip lead", variant: "danger", icon: XCircle, onClick: () => h.setStage("dead") },
        ],
      };

    case "outreached":
      return {
        eyebrowStage: "outreached · waiting",
        headline: "Wait for a reply.",
        caption: "The demo's been sent. You'll see them move to Replies if they respond. Resend if needed.",
        actions: [
          { label: "Resend outreach", variant: "secondary", icon: Send, onClick: h.outreach },
        ],
      };

    case "replied":
      return {
        eyebrowStage: "replied",
        headline: "Triage the reply — is it a yes?",
        caption: "Read what they said. If they want to talk, mark a meeting. If it's a hard no, mark dead.",
        live: true,
        actions: [
          { label: "Mark meeting booked", variant: "primary", icon: Calendar, onClick: h.bookMeeting },
          { label: "Not interested", variant: "danger", icon: XCircle, onClick: () => h.setStage("closed_lost") },
        ],
      };

    case "meeting_booked":
      return {
        eyebrowStage: "meeting booked",
        headline: "After the call, mark it done.",
        caption: "Once you've talked, mark it done and we'll move to improving the site with their real photos + copy.",
        actions: [
          { label: "Mark meeting done", variant: "primary", icon: CheckCircle2, onClick: h.doneMeeting },
          { label: "Reschedule", variant: "secondary", icon: Calendar, onClick: h.bookMeeting },
        ],
      };

    case "meeting_done":
      return {
        eyebrowStage: "meeting done",
        headline: "Improve the site with their real content.",
        caption: "Rebuild using the customer's actual photos, hours, and copy. Moves the lead to 'improved'.",
        actions: [
          { label: "Open improve form", variant: "primary", icon: Sparkles, onClick: h.scrollToImprove },
          { label: "Close — lost", variant: "danger", icon: XCircle, onClick: () => h.setStage("closed_lost") },
        ],
      };

    case "improved":
      return {
        eyebrowStage: "improved · ready to hand over",
        headline: "Attach their domain and hand over.",
        caption: "Point the site at the customer's real domain. After it's live, mark closed-won.",
        actions: [
          { label: "Hand over domain", variant: "primary", icon: Building, onClick: h.scrollToHandover },
        ],
      };

    case "handed_over":
      return {
        eyebrowStage: "handed over",
        headline: lead.custom_domain ? `Live on ${lead.custom_domain}. Mark closed-won.` : "Mark closed-won.",
        caption: "Site is live on their domain. Mark this won to add them to the closed-won queue.",
        actions: [
          { label: "Mark closed — won", variant: "primary", icon: CheckCircle2, onClick: () => h.setStage("closed_won") },
        ],
      };

    case "closed_won":
    case "closed_lost":
    case "dead":
      return null; // terminal — no next step
  }

  return {
    eyebrowStage: lead.stage,
    headline: "No specific next step.",
    caption: "Use the action panel on the right to make a move.",
    actions: [],
  };
}
