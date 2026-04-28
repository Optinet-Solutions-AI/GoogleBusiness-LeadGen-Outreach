import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import compress from "astro-compress";

// astro.config.mjs — Astro build config for the "trades" template.
// Output: static HTML in ./dist (consumed by stage-4-deploy.ts).
//
// `site` is overwritten by stage-3-generate.ts (`SITE_URL` env var passed at
// build time). It must be set per-business so canonical URLs + sitemap.xml
// point at the right host (e.g. https://joesplumbing.com).
//
// Performance pipeline (PageSpeed-100 target):
//   - astro-compress: HTML/CSS/JS/SVG minify + image compression
//   - assets get hashed filenames so they can be cached forever
//   - sitemap.xml + robots.txt + structured data live in BaseLayout
//
// Image strategy:
//   Astro's <Image> uses `sharp` to emit responsive WebP/AVIF with explicit
//   dimensions — that's required for Lighthouse "properly sized" + CLS=0.

export default defineConfig({
  site: process.env.SITE_URL || "https://example.pages.dev",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "auto" },
  image: { service: { entrypoint: "astro/assets/services/sharp" } },
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  integrations: [
    tailwind({ applyBaseStyles: true }),
    sitemap({ changefreq: "weekly", priority: 0.7 }),
    compress({
      CSS: true,
      HTML: true,
      JavaScript: true,
      SVG: true,
      // Image compression handled by sharp via <Image>; skip here to avoid
      // double-processing that occasionally produces bigger files.
      Image: false,
    }),
  ],
});
