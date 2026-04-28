/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // node-vibrant/node + sharp etc. use worker_threads / native bindings
    // that Next.js can't bundle. Treat them as runtime externals.
    serverComponentsExternalPackages: ["node-vibrant"],
  },
};

export default nextConfig;
