"use client";

/**
 * RebuildConfirmModal.tsx — Confirmation modal for the "Rebuild on latest
 * template" action on the lead detail page.
 *
 * Replaces the native `window.confirm()` so the operator gets a styled
 * preview of exactly what will happen + the dollar cost before triggering
 * a paid Gemini + Photos API run.
 *
 * Used by: LeadActions.tsx
 */

import { RefreshCw, X, Sparkles, Image as ImageIcon, Code2, Cloud } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function RebuildConfirmModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[520px] rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-action" />
            <h2 className="text-headline-sm">Rebuild on latest template</h2>
          </div>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-5">
          <p className="text-body-base text-ink-muted leading-relaxed">
            Re-runs the pipeline from the <span className="font-semibold">enrich</span> stage so this
            lead picks up every recent template + code change. The lead&apos;s stage doesn&apos;t change.
          </p>

          <div className="space-y-2.5">
            <p className="text-label-caps text-ink-muted uppercase tracking-wider">What runs</p>
            <Step
              icon={<Sparkles className="h-4 w-4" />}
              label="Stage 2 — Enrichment"
              detail="Refresh brand color + logo (Brandfetch when available, niche-aware monogram otherwise)"
            />
            <Step
              icon={<Code2 className="h-4 w-4" />}
              label="Stage 3 — Generate"
              detail="Re-render data.json with the latest Gemini prompt + Astro template"
            />
            <Step
              icon={<Cloud className="h-4 w-4" />}
              label="Stage 4 — Deploy"
              detail="Push the rebuilt site to Cloudflare Pages (same demo URL)"
            />
          </div>

          <div className="rounded-lg bg-surface-alt border border-rule px-4 py-3 flex items-start gap-3">
            <ImageIcon className="h-4 w-4 text-ink-muted flex-none mt-0.5" />
            <div className="flex-1 text-[12px] text-ink-muted leading-relaxed">
              <span className="font-semibold text-ink">Cost: ~$0.04</span> &middot; ~60–90s
              <p className="mt-1 text-ink-muted">
                1 Gemini call (free tier covers it) + ~6 Google Places Photos lookups.
              </p>
            </div>
          </div>
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex justify-end items-center gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            <RefreshCw />
            Rebuild now
          </Button>
        </footer>
      </section>
    </div>
  );
}

function Step({
  icon,
  label,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded-lg bg-surface-alt border border-rule">
      <span className="grid place-items-center w-7 h-7 rounded-md bg-white border border-rule text-action flex-none">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ink leading-tight">{label}</p>
        <p className="text-[11px] text-ink-muted leading-snug mt-0.5">{detail}</p>
      </div>
    </div>
  );
}
