import "server-only";
import { env } from "./env";

import { evaluateIntegration } from "./integrationAnalysis";
import { refreshPublishedChanges, refreshPublishedSchema } from "./integrationOfficial";
import {
  claimIntegrationMonitorRun, finishIntegrationMonitorRun,
  listManifests, recordRun,
} from "./integrationStore";

export type IntegrationMonitorResult = {
  ran: boolean;
  manifestsChecked: number;
  schemaRefreshed: boolean;
  changesRefreshed: boolean;
  errors: string[];
};

/**
 * Sessionless, due-only worker hook. It calls fixed public Autodesk schema docs
 * and evaluates local snapshots; it never refreshes account-scoped APS data.
 */
export async function runScheduledIntegrationChecks(): Promise<IntegrationMonitorResult> {
  if (env.demoMode) return { ran: false, manifestsChecked: 0, schemaRefreshed: false, changesRefreshed: false, errors: [] };
  if (!claimIntegrationMonitorRun()) {
    return { ran: false, manifestsChecked: 0, schemaRefreshed: false, changesRefreshed: false, errors: [] };
  }
  const result: IntegrationMonitorResult = {
    ran: true, manifestsChecked: 0, schemaRefreshed: false, changesRefreshed: false, errors: [],
  };
  try {
    try { await refreshPublishedSchema(); result.schemaRefreshed = true; }
    catch (error) { result.errors.push(`Schema refresh: ${error instanceof Error ? error.message : String(error)}`); }
    try { await refreshPublishedChanges(); result.changesRefreshed = true; }
    catch (error) { result.errors.push(`Change feed: ${error instanceof Error ? error.message : String(error)}`); }
    for (const manifest of listManifests()) {
      try {
        recordRun(manifest, evaluateIntegration(manifest));
        result.manifestsChecked++;
      } catch (error) {
        result.errors.push(`${manifest.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    finishIntegrationMonitorRun(result.errors.length ? result.errors.join(" | ") : null);
  }
  return result;
}
