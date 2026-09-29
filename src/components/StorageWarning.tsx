import { env } from "@/lib/env";

/**
 * Shown only where the cache has nowhere permanent to live.
 *
 * On a host without a persistent disk the SQLite file — sessions, the uploaded
 * extract, the activity rows — goes away on every restart, redeploy or idle
 * spin-down. The app still works; it just forgets. Saying so up front is the
 * difference between "expected" and "the tool is broken".
 */
export function StorageWarning() {
  if (!env.ephemeralStorage) return null;

  return (
    <div className="border-b border-adsk-gold bg-adsk-gold/15">
      <div className="mx-auto max-w-[1500px] px-6 py-2 text-xs text-adsk-black">
        <strong className="font-legend">Temporary storage.</strong> This deployment has no
        persistent disk, so sign-ins and loaded data are cleared whenever the service restarts or
        is recycled by its host. Nothing in Autodesk is affected — sign in again and
        re-ingest a completed job from <strong>Extracts</strong> to restore the dashboards, which
        costs none of your daily Data Connector quota.
      </div>
    </div>
  );
}
