/**
 * Lets plain Node run the app's source directly in tests.
 *
 * Next.js resolves extensionless relative imports (`./db`); Node ESM does not.
 * This hook retries such specifiers with a `.ts` extension so the tests can
 * import the real modules instead of a copy.
 */
import { registerHooks } from "node:module";

const root = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return nextResolve("next/headers.js", context);
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    const candidate = specifier.startsWith("@/")
      ? new URL(`src/${specifier.slice(2)}`, root).href
      : specifier;
    if ((candidate.startsWith(".") || candidate.startsWith("file:")) && !/\.[cm]?[jt]sx?$/i.test(candidate)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return nextResolve(candidate + ext, context);
        } catch {
          // fall through to the next candidate
        }
      }
    }
    return nextResolve(candidate, context);
  },
});
