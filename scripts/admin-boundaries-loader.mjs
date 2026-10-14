/**
 * Execute real server actions, route handlers and server pages outside Next.
 * Only Next's request/render context is replaced. APS auth, SQLite and the
 * application's business code remain real, so tests cover their boundaries.
 */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const contextModules = {
  "next/headers": `export async function cookies() {
    return { get(name) { return globalThis.__reviewCookieJar?.get(name); },
      set() {}, delete() {} };
  }`,
  "next/cache": `export function revalidatePath(path) {
    (globalThis.__reviewRevalidatedPaths ??= []).push(path);
  }`,
  "next/navigation": `export function redirect(path) { throw new Error("Redirect: " + path); }
    export function notFound() { throw new Error("Not found"); }
    export function usePathname() { throw new Error("Client hook in server test"); }
    export function useRouter() { throw new Error("Client hook in server test"); }
    export function useSearchParams() { throw new Error("Client hook in server test"); }`,
  "next/link": `export default function Link() { throw new Error("Client component in server test"); }`,
  "server-only": "export {};",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in contextModules) {
      return { url: `review-context:${specifier}`, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    const candidate = specifier.startsWith("@/")
      ? new URL(`src/${specifier.slice(2)}`, root).href
      : specifier;
    if ((candidate.startsWith(".") || candidate.startsWith("file:")) &&
        !/\.[cm]?[jt]sx?$/i.test(candidate)) {
      for (const extension of [".ts", ".tsx", "/index.ts"]) {
        try { return nextResolve(candidate + extension, context); } catch { /* next candidate */ }
      }
    }
    return nextResolve(candidate, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("review-context:")) {
      return { format: "module", source: contextModules[url.slice("review-context:".length)], shortCircuit: true };
    }
    if (url.endsWith(".tsx")) {
      const result = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
      });
      return { format: "module", source: result.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
