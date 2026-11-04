/**
 * remotion/index.ts — Remotion entry point (what @remotion/bundler bundles).
 *
 * Inputs:  none
 * Outputs: registerRoot(RemotionRoot)
 * Used by: lib/creatives/video/render-reel.ts (bundle({ entryPoint: this file }))
 */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
