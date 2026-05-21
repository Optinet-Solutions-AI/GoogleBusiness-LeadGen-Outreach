// astro.config.mjs — Astro build config for the "premium-trades" template.
// Output: static HTML in ./dist (consumed by stage-4-deploy.ts).
//
// React integration is required because hero / services / reviews / cta are
// React-island TSX components (Framer Motion needs hydration). All other
// pages remain plain Astro for the smallest possible static output.

import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import compress from "astro-compress";

export default defineConfig({
  site: process.env.SITE_URL || "https://example.pages.dev",
  // BUILD_BASE_PATH is set during multi-niche QA builds so each site can be
  // served from a subdirectory of the same host (e.g. /home-services/...)
  // without the asset URLs breaking. Production builds leave it unset → "/".
  base: process.env.BUILD_BASE_PATH || "/",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "auto" },
  image: { service: { entrypoint: "astro/assets/services/sharp" } },
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    sitemap({ changefreq: "weekly", priority: 0.7 }),
    compress({
      CSS: true,
      HTML: true,
      JavaScript: true,
      SVG: true,
      Image: false,
    }),
  ],
});
