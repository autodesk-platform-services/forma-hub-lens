/**
 * Lets plain Node run the app's source directly in tests.
 *
 * Next.js resolves extensionless relative imports (`./db`); Node ESM does not.
 * This hook retries such specifiers with a `.ts` extension so the tests can
 * import the real modules instead of a copy.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return nextResolve("next/headers.js", context);
    }
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return nextResolve(specifier + ext, context);
        } catch {
          // fall through to the next candidate
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
