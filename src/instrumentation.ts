/** Public schema checks only. No account credentials or Autodesk write operations. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { configProblems } = await import("./lib/env");
  if (configProblems().length) return;
  const { runScheduledIntegrationChecks } = await import("./lib/integrationMonitor");
  const state = globalThis as typeof globalThis & { lensIntegrationMonitor?: ReturnType<typeof setInterval> };
  if (state.lensIntegrationMonitor) return;
  const tick = () => { void runScheduledIntegrationChecks().catch(() => {
    // Detailed errors are stored by the monitor. Never log URLs containing credentials.
  }); };
  state.lensIntegrationMonitor = setInterval(tick, 60_000);
  state.lensIntegrationMonitor.unref();
  tick();
}
