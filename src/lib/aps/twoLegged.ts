import "server-only";

/** This separate demo app never obtains app-only Autodesk credentials. */
export async function getTwoLeggedToken(): Promise<string> {
  throw new Error("App-only Autodesk tokens are disabled in the public demo.");
}
