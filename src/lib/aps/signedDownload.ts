/** Accept only HTTPS S3 download hosts returned by Autodesk; never follow a signed URL to an arbitrary host. */
export function isS3SignedUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".amazonaws.com")) return false;
  const labels = host.split(".");
  const s3 = labels.findIndex((label) => label === "s3" || label.startsWith("s3-"));
  if (s3 < 0) return false;
  const suffix = labels.slice(s3 + 1).join(".");
  return suffix === "amazonaws.com" || /^[a-z0-9-]+\.amazonaws\.com$/.test(suffix) ||
    /^dualstack\.[a-z0-9-]+\.amazonaws\.com$/.test(suffix);
}
