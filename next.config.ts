import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep review output separate from the running local preview's build files.
  distDir: process.env.LENS_REVIEW_BUILD === "1" ? ".next-review"
    : process.env.LENS_PREVIEW_BUILD === "1" ? ".next-preview" : ".next",
  // Emit a self-contained server bundle so the container image doesn't need
  // node_modules. Requires copying .next/static and public/ in the Dockerfile.
  output: "standalone",
  // Local tracing must not package credentials, hub caches or previous builds.
  // Docker also excludes these from its build context.
  outputFileTracingExcludes: {
    "*": ["./.env*", "./.git/**/*", "./.data/**/*", "./.next-preview/**/*",
      "./.next-review/**/*", "./.next-public-review/**/*"],
  },

  // node:sqlite is a Node builtin; keep it out of the bundler's dependency graph.
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Extract ingestion streams multi-MB CSVs through a route handler.
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
