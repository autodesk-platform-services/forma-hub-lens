import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the container image doesn't need
  // node_modules. Requires copying .next/static and public/ in the Dockerfile.
  output: "standalone",

  // node:sqlite is a Node builtin; keep it out of the bundler's dependency graph.
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Extract ingestion streams multi-MB CSVs through a route handler.
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
