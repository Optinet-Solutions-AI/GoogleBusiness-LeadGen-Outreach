/**
 * video/reel-plan.ts — turn a month's posts into a Reel plan: which 9:16 frames, in what order, how long. Pure.
 *
 * Inputs:  creatives (list rows with their latest version's renders), reel settings
 * Outputs: ReelPlan { slides, fps, durationInFrames, … } + the Remotion input props; file naming
 * Used by: lib/creatives/video/render-reel.ts (server), app/api/clients/[id]/reels (validation), remotion/Reel.tsx (types)
 *
 * No DB, no server imports — the Remotion bundle and the dashboard import the types from here.
 */

export const REEL_FPS = 30;
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_MIN_SLIDES = 2;
export const REEL_MAX_SLIDES = 12;
export const REEL_DEFAULT_SLIDE_SEC = 3.5;
export const REEL_DEFAULT_FADE_SEC = 0.5;

export interface ReelSettings {
  slide_sec?: number;
  fade_sec?: number;
  /** Optional opening card text (e.g. the business name). Empty = no intro card. */
  title?: string;
}

export interface ReelSlide {
  creative_id: string;
  /** Public URL of the 9:16 PNG (slide 1 of a carousel). */
  src: string;
  headline: string;
}

export interface ReelBrand {
  primary: string;
  text: string;
  background: string;
  logo_url: string | null;
}

/** What the Remotion composition receives as inputProps. Must stay JSON-serialisable (a `type`, so it satisfies
 *  Remotion's Record<string, unknown> props constraint). */
export type ReelProps = {
  slides: ReelSlide[];
  brand: ReelBrand;
  title: string;
  slideFrames: number;
  fadeFrames: number;
  introFrames: number;
};

export interface ReelPlan {
  props: ReelProps;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  durationSec: number;
}

export type ReelSourceCreative = {
  id: string;
  title: string | null;
  slot_date: string | null;
  latest: {
    state: string;
    renders: { aspect: string; slide: number | null; public_url: string }[];
    inputs?: { headline?: string; colors?: { primary?: string; text?: string; background?: string } } | null;
  } | null;
};

/** The 9:16 frame of a post (slide 1 for carousels), or null when it has none. */
export function portraitFrame(c: ReelSourceCreative): string | null {
  const r = c.latest?.renders.find((x) => x.aspect === "9:16" && (x.slide === null || x.slide === 1));
  return r?.public_url ?? null;
}

/** Posts that can go in a Reel: approved (or any rendered, when `approvedOnly` is false) with a 9:16 frame, by date. */
export function eligibleForReel(creatives: readonly ReelSourceCreative[], approvedOnly = true): ReelSourceCreative[] {
  return creatives
    .filter((c) => portraitFrame(c) && (!approvedOnly || c.latest?.state === "approved"))
    .sort((a, b) => (a.slot_date ?? "").localeCompare(b.slot_date ?? ""));
}

export class ReelPlanError extends Error {}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function planReel(
  creatives: readonly ReelSourceCreative[],
  order: readonly string[],
  settings: ReelSettings,
  brand: Partial<ReelBrand> = {},
): ReelPlan {
  const byId = new Map(creatives.map((c) => [c.id, c]));
  const slides: ReelSlide[] = [];
  for (const id of order) {
    const c = byId.get(id);
    const src = c ? portraitFrame(c) : null;
    if (!c || !src) throw new ReelPlanError(`post ${id} has no 9:16 render`);
    slides.push({ creative_id: id, src, headline: c.latest?.inputs?.headline ?? c.title ?? "" });
  }
  if (slides.length < REEL_MIN_SLIDES) throw new ReelPlanError(`a Reel needs at least ${REEL_MIN_SLIDES} posts`);
  if (slides.length > REEL_MAX_SLIDES) throw new ReelPlanError(`a Reel takes at most ${REEL_MAX_SLIDES} posts`);

  const slideSec = clamp(Number(settings.slide_sec ?? REEL_DEFAULT_SLIDE_SEC) || REEL_DEFAULT_SLIDE_SEC, 1.5, 8);
  const fadeSec = clamp(Number(settings.fade_sec ?? REEL_DEFAULT_FADE_SEC) || 0, 0, Math.min(1.5, slideSec / 2));
  const title = (settings.title ?? "").trim().slice(0, 60);
  const slideFrames = Math.round(slideSec * REEL_FPS);
  const fadeFrames = Math.round(fadeSec * REEL_FPS);
  const introFrames = title ? Math.round(2 * REEL_FPS) : 0;
  // Slides overlap by one fade, so N slides take N*slide - (N-1)*fade; plus the intro, plus a final fade-out.
  const durationInFrames = introFrames + slides.length * slideFrames - (slides.length - 1) * fadeFrames + fadeFrames;

  const first = creatives.find((c) => c.id === order[0])?.latest?.inputs?.colors ?? {};
  const props: ReelProps = {
    slides,
    brand: {
      primary: brand.primary ?? first.primary ?? "#111111",
      text: brand.text ?? first.text ?? "#ffffff",
      background: brand.background ?? first.background ?? "#000000",
      logo_url: brand.logo_url ?? null,
    },
    title,
    slideFrames,
    fadeFrames,
    introFrames,
  };
  return { props, fps: REEL_FPS, width: REEL_WIDTH, height: REEL_HEIGHT, durationInFrames, durationSec: durationInFrames / REEL_FPS };
}

/** `<YYYY-MM>_reel_<n-slides>.mp4` */
export function reelFileName(month: string, slides: number): string {
  return `${month.slice(0, 7)}_reel_${slides}-posts.mp4`;
}

/** Storage path inside the client-assets bucket. */
export function reelStoragePath(clientId: string, reelId: string): string {
  return `${clientId}/reels/${reelId}.mp4`;
}
