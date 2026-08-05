import type { ActivityFilters } from "./queries";

export type SearchParams = Record<string, string | string[] | undefined>;

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
}

function one(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const first = Array.isArray(value) ? value[0] : value;
  return first.trim() || undefined;
}

export function parseFilters(params: SearchParams): ActivityFilters {
  return {
    from: one(params.from),
    to: one(params.to),
    projectIds: many(params.project),
    services: many(params.service),
    actions: many(params.action),
    actor: one(params.actor),
    search: one(params.q),
  };
}

export function filtersToQuery(filters: ActivityFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  for (const id of filters.projectIds ?? []) query.append("project", id);
  for (const service of filters.services ?? []) query.append("service", service);
  for (const action of filters.actions ?? []) query.append("action", action);
  if (filters.actor) query.set("actor", filters.actor);
  if (filters.search) query.set("q", filters.search);
  return query;
}

export function hasAnyFilter(filters: ActivityFilters): boolean {
  return Boolean(
    filters.from ||
      filters.to ||
      filters.projectIds?.length ||
      filters.services?.length ||
      filters.actions?.length ||
      filters.actor ||
      filters.search,
  );
}
