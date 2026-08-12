import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get clientId() {
    return required("APS_CLIENT_ID");
  },
  get clientSecret() {
    return required("APS_CLIENT_SECRET");
  },
  get callbackUrl() {
    return required("APS_CALLBACK_URL");
  },
  get hubId() {
    // Forma Admin and Data Connector both want the hub ID without the "b." prefix
    // that the Data Management API uses.
    return required("FORMA_HUB_ID").replace(/^b\./, "");
  },
  get region() {
    const region = process.env.FORMA_REGION?.trim().toUpperCase();
    return region && region.length > 0 ? region : undefined;
  },
  get dataDir() {
    return process.env.DATA_DIR?.trim() || ".data";
  },
  /**
   * Set on deployments with no persistent disk (e.g. a Render free instance),
   * where the cache is wiped on every restart, redeploy or idle spin-down.
   * Purely cosmetic — it drives a warning banner so the data loss is expected
   * rather than mysterious.
   */
  get ephemeralStorage() {
    const value = process.env.EPHEMERAL_STORAGE?.trim().toLowerCase();
    return value === "true" || value === "1";
  },
};

/** Reports config problems without throwing, so the UI can show a setup screen. */
export function configProblems(): string[] {
  const problems: string[] = [];
  for (const name of ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "FORMA_HUB_ID"]) {
    if (!process.env[name]) problems.push(`${name} is not set`);
  }
  const region = process.env.FORMA_REGION?.trim().toUpperCase();
  if (region && !["US", "EMEA", "AUS"].includes(region)) {
    problems.push(`FORMA_REGION must be US, EMEA or AUS (got "${region}")`);
  }
  return problems;
}
