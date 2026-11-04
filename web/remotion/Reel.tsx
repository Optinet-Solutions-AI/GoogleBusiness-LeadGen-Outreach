/**
 * remotion/Reel.tsx — the Reel composition: optional intro card, then each 9:16 post frame with a slow zoom,
 * crossfades between slides, a thin progress bar. No audio in v1.
 *
 * Inputs:  ReelProps (lib/creatives/video/reel-plan.ts) as Remotion inputProps
 * Outputs: frames rendered by @remotion/renderer (render-reel.ts) into an MP4
 * Used by: remotion/Root.tsx (registered as composition "reel")
 *
 * Plain inline styles only: this file is bundled by Remotion's webpack, not by Next.js, so no Tailwind here.
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelProps } from "../lib/creatives/video/reel-plan";

const FONT = "'Public Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function Slide({ src, start, frames, fade, zoomFrom, zoomTo }: { src: string; start: number; frames: number; fade: number; zoomFrom: number; zoomTo: number }) {
  const frame = useCurrentFrame();
  const local = frame - start;
  if (local < 0 || local >= frames) return null;
  const opacity = interpolate(local, [0, fade, frames - fade, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(local, [0, frames], [zoomFrom, zoomTo], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: "50% 50%" }} />
    </AbsoluteFill>
  );
}

function Intro({ title, logo, frames, primary, text, background }: { title: string; logo: string | null; frames: number; primary: string; text: string; background: string }) {
  const frame = useCurrentFrame();
  if (frame >= frames) return null;
  const inOut = interpolate(frame, [0, 12, frames - 12, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, 18], [40, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${background} 0%, ${primary} 100%)`, alignItems: "center", justifyContent: "center", opacity: inOut }}>
      {logo && <Img src={logo} style={{ width: 320, height: 320, objectFit: "contain", marginBottom: 48, transform: `translateY(${rise}px)` }} />}
      <div style={{ color: text, fontFamily: FONT, fontSize: 84, fontWeight: 800, textAlign: "center", padding: "0 96px", lineHeight: 1.1, transform: `translateY(${rise}px)`, textShadow: "0 4px 24px rgba(0,0,0,.35)" }}>
        {title}
      </div>
    </AbsoluteFill>
  );
}

export const Reel: React.FC<ReelProps> = ({ slides, brand, title, slideFrames, fadeFrames, introFrames }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background }}>
      {slides.map((s, i) => {
        const start = introFrames + i * (slideFrames - fadeFrames);
        return <Slide key={s.creative_id} src={s.src} start={start} frames={slideFrames} fade={fadeFrames} zoomFrom={i % 2 === 0 ? 1 : 1.08} zoomTo={i % 2 === 0 ? 1.08 : 1} />;
      })}
      {introFrames > 0 && <Intro title={title} logo={brand.logo_url} frames={introFrames} primary={brand.primary} text={brand.text} background={brand.background} />}
      {/* progress bar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, background: "rgba(0,0,0,.25)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", background: brand.primary }} />
      </div>
    </AbsoluteFill>
  );
};
