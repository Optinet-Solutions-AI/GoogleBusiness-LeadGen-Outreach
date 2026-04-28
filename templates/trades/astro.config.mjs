import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// astro.config.mjs — Astro build config for the "trades" template.
// Output: static HTML in ./dist (consumed by stage-4-deploy.ts).

export default defineConfig({
  output: "static",
  integrations: [tailwind()],
  build: { format: "directory" },
});
