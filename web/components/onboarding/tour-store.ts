/**
 * onboarding/tour-store.ts — tiny dependency-free store for the guided tour.
 *
 * Inputs:  startTour() / endTour() called from any client event handler.
 * Outputs: an external store (subscribe/getState) the <OnboardingTour/> renders
 *          from; { active } toggles the spotlight walkthrough on/off.
 * Used by: components/onboarding/OnboardingTour.tsx (renderer) +
 *          components/SideNav.tsx ("Take the tour" button).
 *
 * No React context/provider: the store lives at module scope so the SideNav
 * button (a separate client island) can launch the tour mounted in the layout.
 * Mirrors components/ui/toast-store.ts.
 */

export interface TourState {
  active: boolean;
}

type Listener = (state: TourState) => void;

let state: TourState = { active: false };
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable reference between mutations — required by useSyncExternalStore. */
export function getState(): TourState {
  return state;
}

export function startTour(): void {
  if (state.active) return;
  state = { active: true };
  emit();
}

export function endTour(): void {
  if (!state.active) return;
  state = { active: false };
  emit();
}
