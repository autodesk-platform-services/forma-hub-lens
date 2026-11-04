import "server-only";

import type { Session } from "./auth";

export const APS_BASE = "https://developer.api.autodesk.com";

/** This boundary covers all APS calls routed through apsFetch, including absolute URLs. */
export function requireLiveApsSession(_session: Pick<Session, "mode">): void {
  throw new Error("Live Autodesk hub APIs are disabled in the public demo.");
}

export class ApsError extends Error {
  // Assigned in the body rather than via parameter properties: those need a
  // TypeScript emit step, and the tests run this source directly through Node's
  // strip-only type stripping.
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`${status} from ${url}: ${summarise(body)}`);
    this.name = "ApsError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function summarise(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return (
      parsed.detail ??
      parsed.title ??
      parsed.developerMessage ??
      parsed.errorMessage ??
      parsed.reason ??
      body.slice(0, 300)
    );
  } catch {
    return body.slice(0, 300);
  }
}

type ApsFetchOptions = {
  method?: string;
  body?: unknown;
  /** Send the Region header, which Forma Admin endpoints accept. */
  regional?: boolean;
  searchParams?: Record<string, string | number | undefined>;
  timeoutMs?: number;
};

/**
 * Calls an APS endpoint with the signed-in user's token.
 *
 * Retries read requests on 429 and 5xx with backoff. Writes are sent once:
 * a server can finish a POST/PATCH/DELETE before returning an error, and a
 * retry could create a second job or repeat a bulk change.
 */
export async function apsFetch<T>(
  session: Session,
  _path: string,
  _options: ApsFetchOptions = {},
): Promise<T> {
  requireLiveApsSession(session);
  throw new Error("Live Autodesk hub APIs are disabled in the public demo.");
}

/** Walks an offset/limit paginated Forma collection to the end. */
export async function apsPaginate<T>(
  session: Session,
  path: string,
  options: ApsFetchOptions & { limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 100;
  const collected: T[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const body = await apsFetch<{
      results?: T[];
      pagination?: { totalResults?: number; limit?: number; offset?: number };
    }>(session, path, {
      ...options,
      searchParams: { ...options.searchParams, limit, offset },
    });

    if (!body || !Array.isArray(body.results)) {
      throw new Error(`APS returned an unreadable paginated response for ${path}.`);
    }
    const results = body.results;
    collected.push(...results);
    const total = body.pagination?.totalResults;
    const knownTotal = typeof total === "number" && Number.isFinite(total) && total >= 0
      ? total : null;
    if (knownTotal !== null && collected.length >= knownTotal) return collected;
    if (results.length === 0) {
      if (knownTotal !== null && collected.length < knownTotal) {
        throw new Error(`APS pagination ended before all ${knownTotal} records were returned for ${path}.`);
      }
      return collected;
    }
    if (results.length < limit && knownTotal === null) return collected;
    offset += results.length;
  }

  throw new Error(`APS pagination exceeded ${maxPages} pages for ${path}; refresh was not applied.`);
}
