import "server-only";

import { createHash } from "node:crypto";
import { getDb } from "./db";
import { getTable, getTrustedTableSource, listTables, resolveColumn, type DatasetTable } from "./dataset";
import { storedJobs, storedRequests } from "./aps/dataConnector";
import { env } from "./env";
import { latestOfficialSnapshot, saveManifest, CAPABILITY_KEYS, CAPABILITY_LABELS, type IntegrationManifest, type ExpectedType } from "./integrationStore";
import { parsePublishedTables, type PublishedTable } from "./integrationOfficial";

export type CheckStatus = "pass" | "fail" | "unknown" | "review";
export type IntegrationCheck = {
  id: string;
  group: "source" | "schema" | "quality" | "coverage" | "reference" | "classification" | "code" | "api";
  label: string;
  status: CheckStatus;
  detail: string;
  evidence: "uploaded_snapshot" | "cached_aps" | "published_schema" | "admin_recorded_test" | "self_declared" | "unavailable";
};
export type IntegrationPreflight = {
  evaluatedAt: number;
  manifestVersion: number;
  evidenceFingerprint: string;
  status: "blocked" | "needs_review" | "locally_ready";
  checks: IntegrationCheck[];
  counts: Record<CheckStatus, number>;
  note: string;
};

/** Lightweight identity of evidence used by a recorded run; no CSV rows are scanned. */
export function integrationEvidenceFingerprint(manifest: IntegrationManifest): string {
  const names = new Set(manifest.tables.map((item) => item.table));
  if (manifest.classification.takeoff || manifest.classification.quantities || manifest.classification.sheetReferences) {
    ["takeoff_quantity_definitions", "takeoff_settings", "takeoff_takeoff_items", "takeoff_quantities", "classifications_nodes"]
      .forEach((name) => names.add(name));
  }
  if (manifest.classification.estimates) {
    ["estimates_estimation_instances", "estimates_settings", "classifications_nodes"]
      .forEach((name) => names.add(name));
  }
  for (const ref of manifest.references) { names.add(ref.sourceTable); names.add(ref.targetTable); }
  const tables = [...names].sort().map((name) => {
    const table = getTable(name);
    const source = getTrustedTableSource(name);
    return [name, table?.uploadedAt ?? null, table?.rowCount ?? null, table?.truncated ?? null,
      table?.columns ?? null, source?.uploadId ?? null, source?.jobId ?? null];
  });
  const request = manifest.requestId ? storedRequests().find((item) => item.id === manifest.requestId) : null;
  const jobs = manifest.requestId ? storedJobs().filter((item) => item.requestId === manifest.requestId)
    .map((item) => [item.jobId, item.status, item.completionStatus, item.completedAt]) : [];
  const schema = latestOfficialSnapshot("schema");
  return createHash("sha256").update(JSON.stringify({ tables, request: request ? [request.lastSeenAt, request.seenInLastRefresh, request.serviceGroups, request.projectIdList] : null,
    jobs, schema: schema ? [schema.id, schema.digest] : null })).digest("hex");
}

export function isIntegrationPreflightStale(manifest: IntegrationManifest, result: IntegrationPreflight | null | undefined): boolean {
  return !result || result.manifestVersion !== manifest.version || typeof result.evidenceFingerprint !== "string" ||
    result.evidenceFingerprint !== integrationEvidenceFingerprint(manifest);
}

function sqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Unsafe registered dataset identifier.");
  return `"${value}"`;
}

function column(table: DatasetTable | undefined, ...names: string[]): string | null {
  if (!table) return null;
  for (const name of names) {
    const hit = resolveColumn(table, name);
    if (hit) return hit;
  }
  return null;
}

function check(id: string, group: IntegrationCheck["group"], label: string, status: CheckStatus,
  detail: string, evidence: IntegrationCheck["evidence"]): IntegrationCheck {
  return { id, group, label, status, detail, evidence };
}

function sampleType(value: string, type: ExpectedType): boolean {
  const text = value.trim();
  if (type === "any" || type === "text") return true;
  if (type === "number") return Number.isFinite(Number(text));
  if (type === "boolean") return /^(true|false|0|1)$/i.test(text);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(text) && Number.isFinite(Date.parse(text));
  if (type === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
  if (type === "urn") return /^urn:[^\s]+$/i.test(text);
  return false;
}

function registeredTableName(published: PublishedTable): string {
  const table = published.table.replace(/\.csv$/i, "");
  return published.service && !table.startsWith(`${published.service}_`)
    ? `${published.service}_${table}` : table;
}

function publishedType(type: string | null): ExpectedType | null {
  if (!type) return null;
  const value = type.toLowerCase();
  if (value.includes("uuid")) return "uuid";
  if (value.includes("bool")) return "boolean";
  if (value.includes("date") || value.includes("time")) return "date";
  if (/\b(int|double|float|decimal|number|numeric)\b/.test(value)) return "number";
  if (value.includes("urn")) return "urn";
  if (value.includes("string") || value.includes("text")) return "text";
  return null;
}

function distinctValues(table: DatasetTable, field: string, maxRows = 50_000): Set<string> | null {
  if (table.rowCount > maxRows) return null;
  const rows = getDb().prepare(`SELECT DISTINCT TRIM(${sqlIdentifier(field)}) AS value FROM ${sqlIdentifier(table.sqlName)}
    WHERE ${sqlIdentifier(field)} IS NOT NULL AND TRIM(${sqlIdentifier(field)}) <> ''`)
    .all() as Array<{ value: string }>;
  return new Set(rows.map((row) => row.value));
}

function sourceTables(manifest: IntegrationManifest, checks: IntegrationCheck[], now: number): void {
  const known = new Map(listTables().map((item) => [item.name, item]));
  if (manifest.tables.length === 0) {
    checks.push(check("tables-configured", "source", "Required reporting tables", "unknown",
      "No table requirements are defined; uploaded-data readiness cannot be evaluated.", "unavailable"));
  }
  for (const requirement of manifest.tables) {
    const table = known.get(requirement.table);
    if (!table) {
      checks.push(check(`table:${requirement.table}`, "source", requirement.table, "fail",
        "Required table is absent from the locally uploaded ZIP dataset. This does not prove it is absent from Autodesk.", "uploaded_snapshot"));
      continue;
    }
    checks.push(check(`table:${requirement.table}`, "source", requirement.table, table.truncated ? "review" : "pass",
      `${table.rowCount.toLocaleString()} local rows; imported ${new Date(table.uploadedAt).toISOString()}${table.truncated ? "; local import was truncated" : ""}. Source lineage is assessed separately.`, "uploaded_snapshot"));
    const trusted = getTrustedTableSource(requirement.table);
    if (!trusted) {
      checks.push(check(`lineage:${requirement.table}`, "source", `${requirement.table} source lineage`, "review",
        "This current table came from a user ZIP or lacks verified APS job lineage. Its source hub, project selection, and extraction period are not established by Lens.", "uploaded_snapshot"));
    } else {
      const expectedProjects = manifest.expectedProjectIds;
      const wrongHub = trusted.hubId !== env.hubId;
      const wrongRequest = Boolean(manifest.requestId && trusted.requestId !== manifest.requestId);
      const missingScope = trusted.projectScope.kind === "selected_projects"
        ? expectedProjects.filter((id) => !trusted.projectScope.projectIds.includes(id)) : [];
      const expectedGroups = [...new Set([...manifest.expectedServices,
        ...(Object.values(manifest.classification).some(Boolean) ? ["classifications"] : [])])];
      const missingGroups = expectedGroups.filter((group) => !trusted.serviceGroups.includes(group));
      checks.push(check(`lineage:${requirement.table}`, "source", `${requirement.table} source lineage`,
        wrongHub || wrongRequest || missingScope.length || missingGroups.length ? "fail" : "pass",
        `Downloaded directly from APS job ${trusted.jobId} for hub ${trusted.hubId}; request ${trusted.requestId}; ${trusted.projectScope.kind.replace("_", " ")} (${trusted.projectScope.projectStatus}).${wrongHub ? " Source hub differs from this configured hub." : ""}${wrongRequest ? " Source request differs from this manifest's bound request." : ""}${missingScope.length ? ` Expected projects excluded by selection: ${missingScope.slice(0, 8).join(", ")}.` : ""}${missingGroups.length ? ` Required groups absent from request: ${missingGroups.join(", ")}.` : ""} Job scope does not prove every project has rows.`, "cached_aps"));
    }
    if (requirement.maxAgeHours !== null) {
      const completedAt = trusted?.jobCompletedAt ? Date.parse(trusted.jobCompletedAt) : NaN;
      const age = Number.isFinite(completedAt) ? (now - completedAt) / 3_600_000 : null;
      checks.push(check(`age:${requirement.table}`, "quality", `${requirement.table} extract age`,
        age === null ? "unknown" : age > requirement.maxAgeHours ? "fail" : "pass",
        age === null ? `Source job completion time is unavailable or unverified; local import was ${((now - table.uploadedAt) / 3_600_000).toFixed(1)}h ago, which does not establish extract freshness.` :
          `Trusted APS job completed ${age.toFixed(1)}h ago; maximum ${requirement.maxAgeHours}h. This measures extract completion, not when underlying records changed.`,
        age === null ? "unavailable" : "cached_aps"));
    }
    if (requirement.minRows !== null) {
      checks.push(check(`rows:${requirement.table}`, "quality", `${requirement.table} row floor`,
        table.rowCount < requirement.minRows ? "fail" : "pass",
        `${table.rowCount.toLocaleString()} rows versus configured minimum ${requirement.minRows.toLocaleString()}.`, "uploaded_snapshot"));
    }
    if (requirement.baselineRows === null) {
      checks.push(check(`baseline:${requirement.table}`, "quality", `${requirement.table} row baseline`, "unknown",
        "No admin-captured local row baseline. Capture one after reviewing a representative upload.", "unavailable"));
    } else if (requirement.baselineRows === 0) {
      checks.push(check(`baseline:${requirement.table}`, "quality", `${requirement.table} row baseline`, "unknown",
        "Baseline is zero rows, so a percentage comparison is not meaningful.", "uploaded_snapshot"));
    } else {
      const threshold = Math.ceil(requirement.baselineRows * requirement.baselineMinPct / 100);
      checks.push(check(`baseline:${requirement.table}`, "quality", `${requirement.table} row baseline`,
        table.rowCount < threshold ? "fail" : "pass",
        `${table.rowCount.toLocaleString()} rows versus ${requirement.baselineMinPct}% of admin-captured ${requirement.baselineRows.toLocaleString()} row baseline (${threshold.toLocaleString()}).`, "uploaded_snapshot"));
    }
  }
}

function fieldChecks(manifest: IntegrationManifest, checks: IntegrationCheck[]): void {
  const snapshot = latestOfficialSnapshot("schema");
  const official = snapshot ? parsePublishedTables(snapshot.body) : null;
  const published = new Map((official ?? []).map((table) => [registeredTableName(table), table]));
  for (const requirement of manifest.fields) {
    const table = getTable(requirement.table);
    if (!table) continue;
    const col = column(table, requirement.field);
    if (!col) {
      checks.push(check(`field:${requirement.table}.${requirement.field}`, "schema", `${requirement.table}.${requirement.field}`,
        "fail", "Required column is absent from the locally uploaded CSV headers.", "uploaded_snapshot"));
      continue;
    }
    checks.push(check(`field:${requirement.table}.${requirement.field}`, "schema", `${requirement.table}.${requirement.field}`,
      "pass", `Column is present in uploaded headers${requirement.consumerField ? `; mapped to consumer field ${requirement.consumerField}` : ""}.`, "uploaded_snapshot"));
    const publishedTable = published.get(requirement.table);
    if (publishedTable) {
      const publishedColumn = publishedTable.columns.find((item) => item.name === requirement.field);
      if (!publishedColumn) {
        checks.push(check(`published:${requirement.table}.${requirement.field}`, "schema", `Published ${requirement.table}.${requirement.field}`,
          "review", "Not found in the captured Autodesk schema for this service. Verify service/table naming and change history.", "published_schema"));
      } else {
        const actualType = publishedType(publishedColumn.type);
        const compatible = requirement.type === "any" || !actualType || actualType === requirement.type ||
          (requirement.type === "text" && ["uuid", "urn"].includes(actualType));
        checks.push(check(`published:${requirement.table}.${requirement.field}`, "schema", `Published ${requirement.table}.${requirement.field}`,
          compatible ? "pass" : "review",
          `Captured Autodesk schema type: ${publishedColumn.type ?? "unspecified"}; manifest expects ${requirement.type}. Captured ${new Date(snapshot!.capturedAt).toISOString()}.`, "published_schema"));
      }
    }
    const quotedTable = sqlIdentifier(table.sqlName);
    const quotedCol = sqlIdentifier(col);
    if (requirement.maxNullPct !== null) {
      const stats = getDb().prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN ${quotedCol} IS NULL OR TRIM(${quotedCol}) = '' THEN 1 ELSE 0 END) AS missing
        FROM ${quotedTable}`).get() as { total: number; missing: number | null };
      const pct = stats.total ? 100 * Number(stats.missing ?? 0) / stats.total : null;
      checks.push(check(`null:${requirement.table}.${requirement.field}`, "quality", `${requirement.table}.${requirement.field} null rate`,
        pct === null ? "unknown" : pct > requirement.maxNullPct ? "fail" : "pass",
        pct === null ? "No rows to assess." : `${pct.toFixed(2)}% empty across ${stats.total.toLocaleString()} uploaded rows; maximum ${requirement.maxNullPct}%.`, "uploaded_snapshot"));
    }
    if (requirement.type !== "any" && requirement.type !== "text") {
      const values = getDb().prepare(`SELECT ${quotedCol} AS value FROM ${quotedTable}
        WHERE ${quotedCol} IS NOT NULL AND TRIM(${quotedCol}) <> '' LIMIT 1000`).all() as Array<{ value: string }>;
      const invalid = values.filter(({ value }) => !sampleType(value, requirement.type)).length;
      checks.push(check(`type:${requirement.table}.${requirement.field}`, "quality", `${requirement.table}.${requirement.field} value shape`,
        values.length === 0 ? "unknown" : invalid ? "fail" : "pass",
        values.length === 0 ? "No nonempty values were available to exercise the expected type." :
          `${invalid} of ${values.length} sampled nonempty values fail the manifest's ${requirement.type} parser. Uploaded SQLite columns are TEXT; this is a value-shape check, not a verified APS type.`, "uploaded_snapshot"));
    }
  }
}

function coverageChecks(manifest: IntegrationManifest, checks: IntegrationCheck[]): void {
  for (const requirement of manifest.tables) {
    const table = getTable(requirement.table);
    if (!table) continue;
    for (const [kind, fieldName, expected] of [
      ["project", requirement.projectField, manifest.expectedProjectIds],
      ["service", requirement.serviceField, manifest.expectedServices],
    ] as const) {
      if (expected.length === 0) continue;
      const id = `${kind}-coverage:${requirement.table}`;
      if (!fieldName) {
        checks.push(check(id, "coverage", `${requirement.table} ${kind} coverage`, "unknown",
          `No ${kind} field is mapped for this table.`, "unavailable"));
        continue;
      }
      const col = column(table, fieldName);
      if (!col) {
        checks.push(check(id, "coverage", `${requirement.table} ${kind} coverage`, "unknown",
          `Mapped field ${fieldName} is absent from uploaded headers.`, "uploaded_snapshot"));
        continue;
      }
      const values = distinctValues(table, col);
      if (!values) {
        checks.push(check(id, "coverage", `${requirement.table} ${kind} coverage`, "unknown",
          "Table exceeds the 50,000-row distinct-value evaluation limit.", "unavailable"));
        continue;
      }
      const missing = expected.filter((value) => !values.has(value));
      const status = missing.length === 0 ? "pass" : table.truncated || !getTrustedTableSource(requirement.table) ? "unknown" : "fail";
      checks.push(check(id, "coverage", `${requirement.table} ${kind} coverage`, status,
        `${expected.length - missing.length}/${expected.length} expected ${kind} IDs observed${missing.length ? `; missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}` : ""}. ${getTrustedTableSource(requirement.table) ? "APS job lineage is recorded; observed rows still may not cover every source record." : "Source-hub identity for this user ZIP is unverified."}`, "uploaded_snapshot"));
    }
  }
}

function referenceChecks(manifest: IntegrationManifest, checks: IntegrationCheck[]): void {
  for (const requirement of manifest.references) {
    const id = `reference:${requirement.sourceTable}.${requirement.sourceField}:${requirement.targetTable}.${requirement.targetField}`;
    const source = getTable(requirement.sourceTable);
    const target = getTable(requirement.targetTable);
    const sourceCol = column(source, requirement.sourceField);
    const targetCol = column(target, requirement.targetField);
    if (!source || !target || !sourceCol || !targetCol) {
      checks.push(check(id, "reference", "Reference integrity", "unknown",
        `${requirement.sourceTable}.${requirement.sourceField} → ${requirement.targetTable}.${requirement.targetField} cannot be tested because a table or column is absent.`, "unavailable"));
      continue;
    }
    const sourceValues = distinctValues(source, sourceCol);
    const targetValues = distinctValues(target, targetCol);
    if (!sourceValues || !targetValues) {
      checks.push(check(id, "reference", "Reference integrity", "unknown",
        "One side exceeds the 50,000-row distinct-value evaluation limit.", "unavailable"));
      continue;
    }
    const unmatched = [...sourceValues].filter((value) => !targetValues.has(value));
    const pct = sourceValues.size ? 100 * unmatched.length / sourceValues.size : null;
    checks.push(check(id, "reference", `${requirement.sourceTable}.${requirement.sourceField} → ${requirement.targetTable}.${requirement.targetField}`,
      pct === null ? "unknown" : unmatched.length && (source.truncated || target.truncated) ? "unknown" : pct > requirement.maxMissingPct ? "fail" : "pass",
      pct === null ? "No nonempty source keys to exercise this relationship." :
        `${unmatched.length}/${sourceValues.size} distinct source keys unmatched (${pct.toFixed(2)}%); maximum ${requirement.maxMissingPct}%. This checks uploaded rows only.`, "uploaded_snapshot"));
  }
}

function requestChecks(manifest: IntegrationManifest, checks: IntegrationCheck[]): void {
  if (!manifest.requestId) {
    if (manifest.expectedServices.length || Object.values(manifest.classification).some(Boolean)) {
      checks.push(check("request", "source", "Extract request coverage", "unknown",
        "Bind this manifest to an APS Data Connector request ID to assess selected service groups and projects.", "unavailable"));
    }
    return;
  }
  const request = storedRequests().find((item) => item.id === manifest.requestId);
  if (!request || !request.seenInLastRefresh) {
    checks.push(check("request", "source", "Extract request coverage", "unknown",
      "Request is absent from the latest cached APS request refresh. Refresh schedules on Extracts before relying on it.", "cached_aps"));
    return;
  }
  const groups = Array.isArray(request.serviceGroups) ? request.serviceGroups : null;
  const expected = [...new Set([...manifest.expectedServices,
    ...(Object.values(manifest.classification).some(Boolean) ? ["classifications"] : [])])];
  if (!groups) {
    checks.push(check("request", "source", "Extract service groups", "unknown",
      "APS request cache did not include serviceGroups.", "cached_aps"));
  } else {
    const missing = expected.filter((group) => !groups.includes(group));
    checks.push(check("request", "source", "Extract service groups", missing.length ? "fail" : "pass",
      `${expected.length - missing.length}/${expected.length} expected service groups listed in cached request${missing.length ? `; missing ${missing.join(", ")}` : ""}. Cached APS response, not a completed extract.`, "cached_aps"));
  }
  if (manifest.expectedProjectIds.length > 0) {
    if (Array.isArray(request.projectIdList)) {
      const missing = manifest.expectedProjectIds.filter((id) => !request.projectIdList?.includes(id));
      checks.push(check("request-projects", "coverage", "Extract request project selection", missing.length ? "fail" : "pass",
        missing.length ? `Declared projects excluded by selected-project request: ${missing.slice(0, 8).join(", ")}.` :
          `All ${manifest.expectedProjectIds.length} declared projects appear in the cached selected-project request. This does not prove completed files contain their rows.`, "cached_aps"));
    } else {
      checks.push(check("request-projects", "coverage", "Extract request project selection", "unknown",
        "Cached APS request did not expose an explicit project ID list; confirm whether this request covers all intended projects.", "cached_aps"));
    }
  }
  const relevantJobs = storedJobs().filter((item) => item.requestId === manifest.requestId);
  if (relevantJobs.length === 0) {
    checks.push(check("request-jobs", "source", "Linked extract jobs", "unknown",
      "No job for this request appears in Lens's cached APS jobs. Refresh jobs on Extracts.", "cached_aps"));
  } else {
    const latest = relevantJobs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    checks.push(check("request-jobs", "source", "Latest linked extract job",
      latest.status === "failed" || latest.completionStatus && latest.completionStatus !== "success" ? "fail" :
        latest.status === "complete" ? "pass" : "unknown",
      `Job ${latest.jobId}: ${latest.completionStatus ?? latest.status ?? "unknown"}; cached APS status.`, "cached_aps"));
  }
}

function classificationChecks(manifest: IntegrationManifest, checks: IntegrationCheck[]): void {
  const { takeoff, estimates, quantities, sheetReferences } = manifest.classification;
  if (!takeoff && !estimates && !quantities && !sheetReferences) return;
  const neededSources = new Set<string>(["classifications_nodes"]);
  if (takeoff || quantities || sheetReferences) {
    neededSources.add("takeoff_quantity_definitions");
    neededSources.add("takeoff_settings");
  }
  if (quantities) { neededSources.add("takeoff_quantities"); neededSources.add("takeoff_takeoff_items"); }
  if (sheetReferences) neededSources.add("takeoff_takeoff_items");
  if (estimates) { neededSources.add("estimates_estimation_instances"); neededSources.add("estimates_settings"); }
  const explicitlyRequired = new Set(manifest.tables.map((item) => item.table));
  for (const name of neededSources) {
    if (explicitlyRequired.has(name)) continue; // The main source checks already assess its lineage.
    const table = getTable(name);
    if (!table) {
      checks.push(check(`implicit-source:${name}`, "source", `${name} migration evidence`, "unknown",
        "Table is not loaded, so this part of the migration cannot be validated.", "unavailable"));
      continue;
    }
    const source = getTrustedTableSource(name);
    if (!source) {
      checks.push(check(`implicit-source:${name}`, "source", `${name} migration evidence`, "review",
        "This migration table came from a user ZIP or has no APS job lineage; hub and extraction scope are unverified.", "uploaded_snapshot"));
      continue;
    }
    const service = name.split("_")[0];
    const mismatch = source.hubId !== env.hubId || Boolean(manifest.requestId && source.requestId !== manifest.requestId) ||
      !source.serviceGroups.includes(service);
    checks.push(check(`implicit-source:${name}`, "source", `${name} migration evidence`, mismatch ? "fail" : "pass",
      `APS job ${source.jobId}, hub ${source.hubId}, request ${source.requestId}; ${mismatch ? "hub, request, or service group differs from this manifest" : "matches declared source context"}.`, "cached_aps"));
  }
  const groups: Array<{ group: "takeoff" | "estimates"; table: string }> = [];
  if (takeoff || quantities || sheetReferences) groups.push({ group: "takeoff", table: "takeoff_quantity_definitions" });
  if (estimates) groups.push({ group: "estimates", table: "estimates_estimation_instances" });
  const nodeIds = new Set<string>();
  let nodeScanLimited = false;
  for (const { group, table: tableName } of groups) {
    const table = getTable(tableName);
    if (!table) {
      checks.push(check(`class-columns:${group}`, "classification", `${group} five-level columns`, "unknown",
        `${tableName}.csv is not uploaded; migration columns cannot be inspected.`, "unavailable"));
      continue;
    }
    const names = Array.from({ length: 5 }, (_, index) => `classification${index + 1}_node_id`);
    const present = names.map((name) => column(table, name));
    const missing = names.filter((_, index) => !present[index]);
    checks.push(check(`class-columns:${group}`, "classification", `${group} five-level columns`, missing.length ? "fail" : "pass",
      missing.length ? `Missing uploaded columns: ${missing.join(", ")}. Numbered columns are positions, not fixed classification structures.` :
        "All five node ID columns appear in uploaded headers. This does not prove downstream code handles them.", "uploaded_snapshot"));
    for (const col of present.filter((item): item is string => Boolean(item))) {
      const values = distinctValues(table, col);
      if (values) for (const value of values) nodeIds.add(value);
      else nodeScanLimited = true;
    }
    const settings = getTable(`${group}_settings`);
    const switchCol = column(settings, "forma_classifications");
    const projectCol = column(settings, "project_id", "bim360_project_id");
    if (!settings || !switchCol || !projectCol) {
      checks.push(check(`class-switch:${group}`, "classification", `${group} project model switches`, "unknown",
        `No usable ${group}_settings project ID + forma_classifications columns in the uploaded snapshot. Project conversion state is unknown.`, "unavailable"));
    } else if (settings.rowCount > 50_000) {
      checks.push(check(`class-switch:${group}`, "classification", `${group} project model switches`, "unknown",
        "Settings table exceeds the 50,000-row per-project evaluation limit.", "unavailable"));
    } else {
      const rows = getDb().prepare(`SELECT ${sqlIdentifier(projectCol)} AS project_id, ${sqlIdentifier(switchCol)} AS value
        FROM ${sqlIdentifier(settings.sqlName)} WHERE ${sqlIdentifier(projectCol)} IS NOT NULL`)
        .all() as Array<{ project_id: string; value: string | null }>;
      const expected = manifest.expectedProjectIds.length ? new Set(manifest.expectedProjectIds) : null;
      const selected = expected ? rows.filter((row) => expected.has(row.project_id)) : rows;
      const trueCount = selected.filter((row) => /^(true|1)$/i.test(String(row.value ?? ""))).length;
      const falseCount = selected.filter((row) => /^(false|0)$/i.test(String(row.value ?? ""))).length;
      const unknownCount = selected.length - trueCount - falseCount;
      const missing = expected ? [...expected].filter((projectId) => !selected.some((row) => row.project_id === projectId)) : [];
      checks.push(check(`class-switch:${group}`, "classification", `${group} project model switches`,
        selected.length === 0 || unknownCount || missing.length ? "unknown" : "pass",
        `${trueCount} converted, ${falseCount} legacy, ${unknownCount} unreadable switch rows${missing.length ? `, ${missing.length} expected projects missing settings` : ""}. This is per-project snapshot evidence; do not infer state from project creation date.`, "uploaded_snapshot"));
    }
  }
  const nodes = getTable("classifications_nodes");
  const nodeIdCol = column(nodes, "id");
  if (nodeScanLimited) {
    checks.push(check("class-node-refs", "classification", "Classification node IDs", "unknown",
      "At least one source table exceeds the 50,000-row node ID evaluation limit; resolution was not established.", "unavailable"));
  } else if (nodeIds.size === 0) {
    checks.push(check("class-node-refs", "classification", "Classification node IDs", "unknown",
      "No nonempty new node IDs were observed; converted-project joins are not exercised by this upload.", "uploaded_snapshot"));
  } else if (!nodes || !nodeIdCol) {
    checks.push(check("class-node-refs", "classification", "Classification node IDs", "unknown",
      "New node IDs are present, but classifications_nodes.id is unavailable in the uploaded tables.", "unavailable"));
  } else {
    const available = distinctValues(nodes, nodeIdCol);
    if (!available) {
      checks.push(check("class-node-refs", "classification", "Classification node IDs", "unknown",
        "Classifications node table exceeds the 50,000-row evaluation limit.", "unavailable"));
    } else {
      const unmatched = [...nodeIds].filter((id) => !available.has(id));
      checks.push(check("class-node-refs", "classification", "Classification node IDs",
        unmatched.length ? nodes.truncated ? "unknown" : "fail" : "pass",
        `${unmatched.length}/${nodeIds.size} distinct new node IDs do not match classifications_nodes.id in the uploaded snapshot. Structure-aware grouping still requires downstream code evidence.`, "uploaded_snapshot"));
    }
  }
  if (quantities) quantityJoinCheck(checks);
  if (sheetReferences) sheetReferenceCheck(checks);
  for (const key of CAPABILITY_KEYS) {
    const needed = key === "fiveLevels" || key === "structureAware" || key === "perProjectSwitch" ||
      key === "quantityJoins" && quantities || key === "sheetUrnResolution" && sheetReferences;
    if (!needed) continue;
    const evidence = manifest.capabilities[key];
    checks.push(check(`code:${key}`, "code", CAPABILITY_LABELS[key],
      evidence.status === "test_recorded" ? "pass" : evidence.status === "declared" ? "review" : "unknown",
      evidence.status === "test_recorded" ? `Admin-recorded test evidence: ${evidence.reference}. Lens has not inspected pipeline code.` :
        evidence.status === "declared" ? `Admin-declared capability${evidence.reference ? `: ${evidence.reference}` : ""}; no test evidence recorded.` :
          "No downstream implementation or test evidence recorded. CSV columns cannot prove pipeline support.",
      evidence.status === "test_recorded" ? "admin_recorded_test" : evidence.status === "declared" ? "self_declared" : "unavailable"));
  }
}

function quantityJoinCheck(checks: IntegrationCheck[]): void {
  const quantities = getTable("takeoff_quantities");
  const items = getTable("takeoff_takeoff_items");
  const definitions = getTable("takeoff_quantity_definitions");
  const quantityItem = column(quantities, "item_id");
  const quantityOrder = column(quantities, "quantity_order");
  const itemId = column(items, "id");
  const itemType = column(items, "type_id");
  const definitionType = column(definitions, "type_id");
  const definitionOrder = column(definitions, "quantity_order");
  const quantityProject = column(quantities, "project_id", "bim360_project_id");
  const itemProject = column(items, "project_id", "bim360_project_id");
  const definitionProject = column(definitions, "project_id", "bim360_project_id");
  if (!quantities || !items || !definitions || !quantityItem || !quantityOrder || !itemId || !itemType || !definitionType || !definitionOrder) {
    checks.push(check("class-quantities", "classification", "Takeoff quantity relationship", "unknown",
      "Required quantities, takeoff_items and quantity_definitions tables/keys are not all available.", "unavailable"));
    return;
  }
  if (quantities.rowCount > 50_000 || items.rowCount > 50_000 || definitions.rowCount > 50_000) {
    checks.push(check("class-quantities", "classification", "Takeoff quantity relationship", "unknown",
      "One table exceeds the 50,000-row integrity-test limit.", "unavailable"));
    return;
  }
  const db = getDb();
  const projectScoped = Boolean(quantityProject && itemProject && definitionProject);
  const itemRows = db.prepare(`SELECT ${sqlIdentifier(itemId)} AS id, ${sqlIdentifier(itemType)} AS type_id,
    ${itemProject ? sqlIdentifier(itemProject) : "NULL"} AS project_id FROM ${sqlIdentifier(items.sqlName)}`)
    .all() as Array<{ id: string | null; type_id: string | null; project_id: string | null }>;
  const definitionRows = db.prepare(`SELECT ${sqlIdentifier(definitionType)} AS type_id, ${sqlIdentifier(definitionOrder)} AS quantity_order,
    ${definitionProject ? sqlIdentifier(definitionProject) : "NULL"} AS project_id FROM ${sqlIdentifier(definitions.sqlName)}`)
    .all() as Array<{ type_id: string | null; quantity_order: string | null; project_id: string | null }>;
  const quantityRows = db.prepare(`SELECT ${sqlIdentifier(quantityItem)} AS item_id, ${sqlIdentifier(quantityOrder)} AS quantity_order,
    ${quantityProject ? sqlIdentifier(quantityProject) : "NULL"} AS project_id FROM ${sqlIdentifier(quantities.sqlName)}`)
    .all() as Array<{ item_id: string | null; quantity_order: string | null; project_id: string | null }>;
  const itemMap = new Map(itemRows.filter((row) => row.id).map((row) => [JSON.stringify(projectScoped ? [row.project_id, row.id] : [row.id]), row.type_id]));
  const definitionPairs = new Set(definitionRows.map((row) => JSON.stringify(projectScoped ? [row.project_id, row.type_id, row.quantity_order] : [row.type_id, row.quantity_order])));
  const present = quantityRows.filter((row) => row.item_id);
  const missing = present.filter((row) => {
    const typeId = itemMap.get(JSON.stringify(projectScoped ? [row.project_id, row.item_id] : [row.item_id]));
    return !typeId || !definitionPairs.has(JSON.stringify(projectScoped ? [row.project_id, typeId, row.quantity_order] : [typeId, row.quantity_order]));
  });
  checks.push(check("class-quantities", "classification", "Takeoff quantity relationship",
    present.length === 0 ? "unknown" : missing.length && (quantities.truncated || items.truncated || definitions.truncated) ? "unknown" : missing.length ? "fail" : projectScoped ? "pass" : "review",
    present.length === 0 ? "No quantity rows with item IDs to exercise the join." :
      `${missing.length}/${present.length} quantity rows fail quantities.item_id → takeoff_items.id → (type_id, quantity_order) → quantity_definitions.${projectScoped ? " The join is scoped by project ID on all three tables." : " At least one table lacks project ID; a passing join could match a record from another project."}`, "uploaded_snapshot"));
}

function sheetReferenceCheck(checks: IntegrationCheck[]): void {
  const items = getTable("takeoff_takeoff_items");
  const content = column(items, "content_version");
  if (!items || !content) {
    checks.push(check("class-sheet-urn", "classification", "Converted 2D sheet references", "unknown",
      "takeoff_items.content_version is unavailable in uploaded data.", "unavailable"));
    return;
  }
  const values = distinctValues(items, content);
  if (!values) {
    checks.push(check("class-sheet-urn", "classification", "Converted 2D sheet references", "unknown",
      "takeoff_items exceeds the 50,000-row value-shape limit.", "unavailable"));
    return;
  }
  const urns = [...values].filter((value) => /^urn:/i.test(value));
  checks.push(check("class-sheet-urn", "classification", "Converted 2D sheet references", "review",
    `${urns.length}/${values.size} distinct nonempty content_version values have a URN shape. Lens cannot identify converted rows without matching project settings or prove Data Management resolution from this CSV alone.`, "uploaded_snapshot"));
}

/** Report only what the current local evidence proves; never infer pipeline support from CSV presence. */
export function evaluateIntegration(manifest: IntegrationManifest, now = Date.now()): IntegrationPreflight {
  const checks: IntegrationCheck[] = [];
  requestChecks(manifest, checks);
  sourceTables(manifest, checks, now);
  fieldChecks(manifest, checks);
  coverageChecks(manifest, checks);
  referenceChecks(manifest, checks);
  classificationChecks(manifest, checks);
  if (manifest.dependencies.length === 0) {
    checks.push(check("api-dependencies", "api", "API dependencies", "unknown",
      "No API dependency paths were declared; deprecation impact cannot be fully matched.", "unavailable"));
  }
  const counts = { pass: 0, fail: 0, unknown: 0, review: 0 };
  for (const item of checks) counts[item.status]++;
  return {
    evaluatedAt: now, manifestVersion: manifest.version,
    evidenceFingerprint: integrationEvidenceFingerprint(manifest),
    status: counts.fail ? "blocked" : counts.unknown || counts.review ? "needs_review" : "locally_ready",
    checks, counts,
    note: "This preflight combines cached APS request/job metadata, current local reporting tables with per-table lineage, published schema captures, and admin-recorded claims. It is not a live guarantee about project conversion, pipeline code, or source-record coverage.",
  };
}

/** Capture a reviewed local row-count baseline as a new, versioned manifest revision. */
export function captureRowBaselines(manifest: IntegrationManifest, actor: string | null): IntegrationManifest {
  const updated: IntegrationManifest = {
    ...manifest,
    version: manifest.version + 1,
    updatedAt: Date.now(), updatedBy: actor,
    tables: manifest.tables.map((requirement) => ({
      ...requirement, baselineRows: getTable(requirement.table)?.rowCount ?? requirement.baselineRows,
    })),
  };
  saveManifest(updated, actor);
  return updated;
}
