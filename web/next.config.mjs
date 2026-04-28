/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // The 5-stage pipeline shells out to npm/Astro and hits external APIs.
  // It runs as a CLI (scripts/run-batch.ts), NOT inside Route Handlers, so we
  // don't need to extend serverless function timeouts here.
};

export default nextConfig;
