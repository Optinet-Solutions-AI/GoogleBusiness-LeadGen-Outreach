/**
 * remotion/Root.tsx — registers the compositions Remotion can render.
 *
 * Inputs:  none (defaults are placeholders; real props arrive as inputProps at render time)
 * Outputs: <Composition id="reel"> sized 1080x1920 @ 30 fps
 * Used by: remotion/index.ts (registerRoot) → @remotion/bundler
 *
 * calculateMetadata sizes the duration from the input props so one composition serves every Reel length.
 */
import React from "react";
import { Composition } from "remotion";
import { Reel } from "./Reel";
import { REEL_FPS, REEL_HEIGHT, REEL_WIDTH, type ReelProps } from "../lib/creatives/video/reel-plan";

const DEFAULTS: ReelProps = {
  slides: [],
  brand: { primary: "#111111", text: "#ffffff", background: "#000000", logo_url: null },
  title: "",
  slideFrames: 105,
  fadeFrames: 15,
  introFrames: 0,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="reel"
    component={Reel}
    width={REEL_WIDTH}
    height={REEL_HEIGHT}
    fps={REEL_FPS}
    durationInFrames={30}
    defaultProps={DEFAULTS}
    calculateMetadata={({ props }) => {
      const n = props.slides.length;
      const frames = props.introFrames + n * props.slideFrames - Math.max(0, n - 1) * props.fadeFrames + props.fadeFrames;
      return { durationInFrames: Math.max(30, frames) };
    }}
  />
);
