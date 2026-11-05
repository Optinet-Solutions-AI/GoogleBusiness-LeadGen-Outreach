/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // node-vibrant/node + sharp etc. use worker_threads / native bindings
    // that Next.js can't bundle. Treat them as runtime externals.
    // Remotion (Reels) ships its own webpack + esbuild and a native compositor: it only ever runs on the Cloud
    // Run job, but the reels API route imports it for the local-dev fallback, so keep it out of the bundle.
    serverComponentsExternalPackages: ["node-vibrant", "remotion", "@remotion/bundler", "@remotion/renderer", "esbuild", "playwright"],
  },
};

export default nextConfig;
