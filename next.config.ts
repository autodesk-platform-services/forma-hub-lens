import type { NextConfig } from "next";
import { securityHeaderRules } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  async headers() {
    return securityHeaderRules(process.env.NODE_ENV);
  },
  output: "standalone",
  // The synthetic query database is a Node built-in, never a persisted file.
  serverExternalPackages: ["node:sqlite"],
  outputFileTracingExcludes: { "*": ["./.env*", "./.git/**/*", "./.data/**/*", "./.vercel/**/*"] },
};

export default nextConfig;
