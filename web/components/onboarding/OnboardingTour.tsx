"use client";

/**
 * onboarding/OnboardingTour.tsx — first-time-user guided tour (spotlight).
 *
 * Inputs:  TOUR_STEPS (config) + tour-store (active state) + localStorage flag.
 * Outputs: on first visit, a welcome card (Start tour / Skip); if started, dims
 *          the screen and spotlights real UI (data-tour targets) one step at a
 *          time with a tooltip + Back/Next/Skip. Re-launchable from the SideNav.
 * Used by: app/(dashboard)/layout.tsx (mounted once, beside <Toaster/>).
 *
 * Pure client-side: no DB/API/deps. Completion persists in localStorage so the
 * tour shows once; bump DONE_KEY to re-show after a major redesign.
 */

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { X, ArrowLeft, ArrowRight, Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TOUR_STEPS, type TourStep } from "./tour-steps";
import { subscribe, getState, startTour, endTour } from "./tour-store";

const DONE_KEY = "rateup_tour_done_v1";
const HIGHLIGHT_PAD = 6;
const TOOLTIP_W = 340;
const GAP = 16;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const serverState = { active: false };

export function OnboardingTour() {
  const state = useSyncExternalStore(
    subscribe,
    getState,
    () => serverState,
  );
  const active = state.active;

  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // First visit → auto-launch the tour.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(DONE_KEY)) startTour();
    } catch {
      /* localStorage blocked (private mode) — skip silently */
    }
  }, []);

  // Reset to the first step whenever the tour (re)opens.
  useEffect(() => {
    if (active) setStepIndex(0);
  }, [active]);

  const step: TourStep | undefined = active ? TOUR_STEPS[stepIndex] : undefined;

  // Measure the spotlight target for the current step.
  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
  }, [active, stepIndex, measure]);

  useEffect(() => {
    if (!active) return;
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [active, measure]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(DONE_KEY, "1");
    } catch {
      /* ignore */
    }
    endTour();
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= TOUR_STEPS.length - 1) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [finish]);

  const back = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  // Esc closes the tour.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finish]);

  if (!active || !step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;
  // A target step with no element found (e.g. mobile) falls back to a center card.
  const spotlight = Boolean(step.target) && rect !== null;

  const card = (
    <div className="w-[340px] max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-rule shadow-xl pointer-events-auto">
      <header className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-rule">
        <h2 className="text-headline-sm leading-snug">{step.title}</h2>
        <button
          onClick={finish}
          aria-label="Close tour"
          className="text-ink-subtle hover:text-ink-muted -mr-1 -mt-0.5"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="px-5 py-4">
        <p className="text-body-base text-ink-muted leading-relaxed">{step.body}</p>
      </div>

      <footer className="px-5 py-3.5 bg-surface-alt border-t border-rule flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? "w-4 bg-action" : "w-1.5 bg-rule"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {isFirst ? (
            <>
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
              <Button variant="primary" size="sm" onClick={next}>
                <Compass />
                Start tour
              </Button>
            </>
          ) : isLast ? (
            <Button variant="primary" size="sm" onClick={finish}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={back}>
                <ArrowLeft />
                Back
              </Button>
              <Button variant="primary" size="sm" onClick={next}>
                Next
                <ArrowRight />
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );

  // ── Centered card (welcome / closing / mobile fallback) ──────────────
  if (!spotlight) {
    return (
      <div className="fixed inset-0 z-[80] bg-ink/45 backdrop-blur-[2px] flex items-center justify-center p-4">
        {card}
      </div>
    );
  }

  // ── Spotlight: dim everything except the target via a giant box-shadow ──
  const r = rect as Rect;
  const hi = {
    top: r.top - HIGHLIGHT_PAD,
    left: r.left - HIGHLIGHT_PAD,
    width: r.width + HIGHLIGHT_PAD * 2,
    height: r.height + HIGHLIGHT_PAD * 2,
  };

  const tip = tooltipPosition(hi, step.placement);

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Transparent click-blocker — keeps the UI uninteractive during the tour */}
      <div className="absolute inset-0" onClick={finish} />

      {/* Highlight box: the box-shadow is what dims the rest of the screen */}
      <div
        className="absolute rounded-lg ring-2 ring-action/70 pointer-events-none transition-all duration-200"
        style={{
          top: hi.top,
          left: hi.left,
          width: hi.width,
          height: hi.height,
          boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)",
        }}
      />

      {/* Tooltip */}
      <div className="absolute" style={tip}>
        {card}
      </div>
    </div>
  );
}

/** Position the tooltip beside the highlight, clamped to the viewport. */
function tooltipPosition(
  hi: Rect,
  placement: "center" | "right" | "bottom",
): React.CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const clampLeft = (l: number) =>
    Math.max(GAP, Math.min(l, vw - TOOLTIP_W - GAP));
  const clampTop = (t: number) => Math.max(GAP, Math.min(t, vh - 200));

  if (placement === "bottom") {
    return {
      top: clampTop(hi.top + hi.height + GAP),
      left: clampLeft(hi.left),
    };
  }
  // "right" — but if it would overflow, drop below the target instead.
  const rightEdge = hi.left + hi.width + GAP;
  if (rightEdge + TOOLTIP_W <= vw - GAP) {
    return { top: clampTop(hi.top), left: rightEdge };
  }
  return {
    top: clampTop(hi.top + hi.height + GAP),
    left: clampLeft(hi.left),
  };
}
