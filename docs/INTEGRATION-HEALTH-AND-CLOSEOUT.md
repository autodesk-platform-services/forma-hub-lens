# Integration Health and Closeout

These workflows fit into the existing six navigation areas:

| Workspace | New workflow |
| --- | --- |
| Data | Integration Health: consumer manifests, migration map, extraction inventory, API change watch, semantic preflights |
| Projects | Closeout readiness: portfolio review, project evidence, exceptions, record documents, handover packages and history |
| Admin | Turnover profiles: reusable requirements and expected deliverables |

Project 360 links to that project's closeout and migration map. Overview includes current saved integration and closeout blockers in its attention queue. Hub Admin and Executive Overview can read these pages. Saving settings, refreshing evidence, importing reporting snapshots, building packages and recording acceptance require Hub Admin access.

## Integration Health workflow

1. Open **Data → Integration Health → New manifest**. Register a consumer, owner, extraction request, expected projects and service groups, required tables/fields/types, reference relationships, freshness thresholds and API property dependencies. Capabilities of downstream code are declarations or recorded test evidence; Lens does not inspect a Power BI model or execute a customer's ETL pipeline.
2. Refresh **Extraction inventory** to retrieve the accessible APS requests and jobs. Scope, service groups, status, successful completion, extraction mode and available files remain associated with their request/job identifiers.
3. On **Extracts**, use the reporting-ingest action on a completed successful job to load its CSV tables with verified APS lineage. This stages all tables and swaps them atomically. A user-supplied ZIP is labeled separately; replacing a table with a ZIP clears that table's trusted lineage.
4. Refresh the published schema and change feed. **Schema and migration map** reads actual per-project Takeoff and Estimate settings, classification node columns and content-reference evidence. Missing settings remain Unknown. It does not infer conversion from a project's creation date.
5. Run a manifest preflight. Inspect missing project coverage, required service groups, field/type drift, referential integrity, freshness, row drops and null changes. The classification checks include five node levels, per-project switching, node resolution and project-scoped quantity relationships. Capture a baseline only after reviewing the current evidence.
6. Open **API change watch** for impacts matched to registered dependencies. The seeded classification notice includes its official source and removal date. Additional notices can be registered explicitly; Lens is not a complete autonomous crawler of every APS release announcement.
7. Optionally enable **Scheduled local checks**. The server refreshes fixed public Autodesk schema/change endpoints and evaluates local manifests when due. The server must remain running. It does not refresh authenticated project/job inventory or connect to downstream systems in the background.

Stored runs are versioned and retain evidence. If a relevant manifest, dataset, request/job or published schema capture changes, the run is marked stale and needs another preflight. Passing local checks is not certification of an external integration.

### Full extracts and CDC

Inventory distinguishes full, delta, mixed and unknown requests. A CDC group without date filters represents a full extraction; date-filtered CDC represents change records. **Delta or mixed jobs cannot replace reporting snapshots.** Applying updates and deletion tombstones to a downstream dataset needs a dedicated merge consumer, which this implementation does not provide. Existing recurring full-extract workflows remain available.

## Closeout workflow

1. Open **Admin → Turnover profiles**. Define applicable project types, business units, clients, regions or delivery models and the required evidence domains. Add guided file, asset, relationship and project-metadata rules. Choose closure policies explicitly for Issues, RFIs, Forms, Submittals and Reviews; an open record is not automatically a turnover blocker.
2. Register expected deliverables at profile or project scope. An expectation can name a document and folder before it exists, or identify an exact source record. Matching multiple records is an ambiguity to resolve. Requirements and register entries can be edited or removed with history.
3. Open **Projects → Closeout readiness**, choose a project and assign its profile. Refresh project evidence from APS. The scan reads Files, Assets, Issues, Forms, Submittals, Reviews, RFIs, Transmittals, Relationships and Sheets, subject to the signed-in account's access and supported endpoints.
4. Inspect source coverage and findings. Authenticated complete scans and trusted full APS reporting imports carry lineage. A user ZIP needs a Hub Admin attestation for that exact revision and project. Partial pagination, failed calls, missing domains and truncated imports remain Unknown. A newer failed live scan is not silently replaced with an older successful CSV.
5. Follow each exception to its source evidence page. Inspect required folders, naming/extensions/metadata, asset attributes/status/location/document relationships, unresolved workflows and exact-version review outcomes. A closed review alone does not prove approval of a particular file version.
6. Select final record documents from the current Files candidates. Each selection pins an item, version and evidence revision. Reassess after changing evidence, requirements or selections. Saved portfolio assessments are marked stale when their supporting state changes.
7. Build a package and review its outcome independently of the assessment. Files are fetched through authenticated exact-version Data Management lookups and verified storage downloads. An inaccessible, mismatched, unapproved or oversized record produces a visible exception rather than an apparently delivered file.
8. Download the immutable ZIP. It contains a machine-readable manifest, CSV/HTML inventory, exception register, available source records and selected verified file bytes. Asset handover indexes connect assets to exact available files, forms, issues, RFIs, submittals, photos and locations; unresolved relationships are identified explicitly. File hashes and the ZIP hash are retained and checked on download.
9. Record **local acceptance** with a sign-off note and individual acknowledgment of every outstanding displayed exception. This preserves the package and its exceptions; acknowledgment does not resolve a blocker. Portfolio package history keeps the reviewed record.

If exceptions exceed the 500-item review cap, the diagnostic package can be downloaded but acceptance is blocked until the assessment is narrowed or the exceptions are resolved and a new package is built.

### Package and evidence boundaries

- The first implementation packages at most **100 selected files**, **25 MiB per file** and **100 MiB total file bytes**. Overflow and failed downloads are exceptions. This is not yet a bulk 4,000-document export service.
- The current Files scan inspects folder contents and their current tip versions; it does not enumerate every historical version. The selection UI shows at most 75 current candidates. Large projects and historical final-version selection need a more scalable document-selection/export workflow.
- Live scans have explicit page, row, folder, time and serialized-snapshot bounds. Reaching a bound never establishes complete coverage. The portfolio view shows up to 500 projects and states its display scope.
- Transmittals are read for distribution evidence. Lens does not create Autodesk transmittals or automatically start Reviews workflows.
- Acceptance is a Lens record. It is not an owner/operator's formal external acceptance or an Autodesk workflow approval.
- Packages can provide structured input to FM, CMMS or data-lake integrations, but do not push to those external systems.

## Official contract sources

- [Autodesk Data Connector change notice](https://help.autodesk.com/cloudhelp/ENU/Docs-Insight/files/data-connector/Data_Connector_Change_Notice.html): per-project classification settings, migration dates, five node levels and converted Takeoff content references.
- [Public Data Connector schema endpoints](https://aps.autodesk.com/blog/data-connector-schema-now-public-endpoints): published schema and change feed.
- [Data Connector Delta Extraction](https://aps.autodesk.com/blog/efficient-incremental-data-sync-data-connector-delta-extraction): public-beta CDC and full/delta extraction behavior.
- [Classifications property deprecation](https://aps.autodesk.com/blog/deprecation-notice-isbasedonaccounttree-autodesk-forma-classifications-api): `isBasedOnAccountTree`, `treeConnectionType` and March 23, 2027 removal.
- [Assets API](https://aps.autodesk.com/blog/accbim-360-assets-api-general-availability), [Reviews API](https://aps.autodesk.com/blog/autodesk-construction-cloud-reviews-api-general-availability), [Transmittals API](https://aps.autodesk.com/blog/autodesk-construction-cloud-transmittals-api-general-availability), [Relationships API](https://aps.autodesk.com/blog/bim-360acc-relationships-api), and [Sheets collection filtering](https://aps.autodesk.com/blog/acc-sheet-api-added-endpoints-reading-collection).

## Verification

`npm test` includes integration contracts, trusted reporting import, CDC replacement protection, closeout rules, exact project/version isolation, package integrity/acceptance and asset relationship tests. `npm run typecheck` and `npm run build` verify the application. Tests use isolated local fixtures and mocked APS responses; live permissions and record availability still depend on the configured hub.
