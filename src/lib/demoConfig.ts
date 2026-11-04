/** Public demo identifiers are fictional and never identify an Autodesk hub. */
export const DEMO_HUB_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_HUB_NAME = "Northwind Builders · Sample hub";

export type LensMode = "live" | "demo";

export function lensMode(value = process.env.LENS_MODE): LensMode {
  const mode = value?.trim().toLowerCase() || "demo";
  if (mode !== "demo") throw new Error("This repository is demo-only. LENS_MODE must be demo; live mode is unavailable.");
  return "demo";
}

/** Mode links are deployment links, never a switch of authorization or storage. */
export function hubDeploymentUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch { return undefined; }
}
