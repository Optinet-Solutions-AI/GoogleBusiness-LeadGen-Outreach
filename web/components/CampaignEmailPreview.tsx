/**
 * CampaignEmailPreview.tsx — Server component: render every step of the email
 * sequence a campaign will send, using a real sample member's data so the
 * operator can review the exact copy (subject + body) and which steps carry the
 * demo screenshot / link, before launching.
 *
 * Inputs:  segment (build/improve/services driver) + a sample member { business_name, demo_url }
 * Outputs: a card per step (Day 0/4/8/12), tokens filled + one spintax variant resolved
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx
 *
 * The copy itself lives in lib/email/sequence-templates.ts (spintax + per-business
 * variation + tokens). This only DISPLAYS it; it does not send.
 */

import {
  renderSequenceEmail,
  variantFor,
  maxStepForVariant,
  type SeqStep,
  type SeqCopyOverride,
} from "@/lib/email/sequence-templates";
import type { CallSegment } from "@/lib/segment";

const DAY_BY_STEP: Record<number, number> = { 1: 0, 2: 4, 3: 8, 4: 12 };

export function CampaignEmailPreview({
  segment,
  sample,
  overrides,
  stepDates,
}: {
  segment: CallSegment;
  sample: { business_name: string; demo_url: string | null };
  /** Per-step operator copy overrides (step number as string). */
  overrides?: Record<string, SeqCopyOverride> | null;
  /** Projected real send date per step (e.g. { 1: "Mon, Jun 30, 9:14 AM EDT" }). */
  stepDates?: Record<number, string> | null;
}) {
  const variant = variantFor(segment);
  const maxStep = maxStepForVariant(variant);
  const steps = Array.from({ length: maxStep }, (_, i) => {
    const step = (i + 1) as SeqStep;
    const r = renderSequenceEmail(
      { business_name: sample.business_name, demo_url: sample.demo_url, call_segment: segment },
      step,
      overrides?.[String(step)] ?? null,
    );
    // Make the screenshot marker visible in the preview.
    const html = r.html.replace(
      /<!--SCREENSHOT-->/g,
      `<p style="border:1px dashed #c9c9c9;border-radius:8px;padding:14px;text-align:center;color:#8a8a8a;font-size:12px;background:#fafafa">[ inline screenshot of the demo site ]</p>`,
    );
    return { step, day: DAY_BY_STEP[step] ?? (step - 1) * 4, ...r, html };
  });

  return (
    <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
      <div className="flex items-baseline gap-2">
        <p className="eyebrow text-ink-muted">Emails that will be sent</p>
        <span className="text-[11px] text-ink-subtle">
          {variant === "services"
            ? "AI-services pitch · 2 steps"
            : variant === "improve"
              ? "Improve pitch · 4 steps"
              : "Build pitch · 4 steps"}
        </span>
      </div>
      <div className="rounded-md bg-positive-soft border border-positive/30 px-3 py-2 text-[11px] text-ink">
        <span className="font-semibold text-positive">Varied per lead — not bulk-identical.</span>{" "}
        Previewed with <span className="font-medium">{sample.business_name}</span> (one example). Every
        recipient gets: their own business name &amp; details, a randomized <span className="font-medium">spintax</span>{" "}
        wording{variant === "services" ? " (one of several distinct versions of this pitch)" : ""}, and
        auto-translation to their country&apos;s language at send time. So no two prospects receive a
        byte-identical email, which is what protects the sending accounts from spam filters.
      </div>

      <div className="space-y-3">
        {steps.map((s) => (
          <div key={s.step} className="rounded-lg border border-rule overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-alt border-b border-rule">
              <span className="mono-num text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                Step {s.step} · Day {s.day}
              </span>
              {stepDates?.[s.step] && (
                <span className="text-[10px] text-ink-subtle">
                  Sends ~{stepDates[s.step]}
                </span>
              )}
              {s.useScreenshot && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-action-soft text-action border border-action/30">
                  + screenshot
                </span>
              )}
              {s.useLink && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-action-soft text-action border border-action/30">
                  + live link
                </span>
              )}
            </div>
            <div className="px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ink mb-1.5">{s.subject}</p>
              <div
                className="text-[13px] text-ink-muted leading-relaxed [&_p]:mb-2 [&_a]:text-action [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: s.html }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
