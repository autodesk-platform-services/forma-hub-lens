import "server-only";

import { env } from "../env";
import type { Session } from "./auth";

export const APS_BASE = "https://developer.api.autodesk.com";

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
};

/**
 * Calls an APS endpoint with the signed-in user's token.
 *
 * Retries 429 and 5xx a couple of times with backoff — Data Connector and Admin
 * both rate limit, and a transient 503 shouldn't blank out a dashboard panel.
 */
export async function apsFetch<T>(
  session: Session,
  path: string,
  options: ApsFetchOptions = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${APS_BASE}${path}`);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.regional && env.region) headers["Region"] = env.region;

  let lastError: ApsError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    const body = await res.text();
    lastError = new ApsError(res.status, url.toString(), body);

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) break;

    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 15_000)
      : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw lastError ?? new Error(`Request to ${url} failed`);
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

  for (let page = 0; page < maxPages; page++) {
    const body = await apsFetch<{
      results?: T[];
      pagination?: { totalResults?: number; limit?: number; offset?: number };
    }>(session, path, {
      ...options,
      searchParams: { ...options.searchParams, limit, offset: page * limit },
    });

    const results = body.results ?? [];
    collected.push(...results);
    if (results.length < limit) break;
    const total = body.pagination?.totalResults;
    if (typeof total === "number" && collected.length >= total) break;
  }

  return collected;
}
