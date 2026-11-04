# Feature guide and source limits

This guide describes **Forma Hub Lens (Demo)**. All portfolio sources are bundled fictional fixtures. Anyone can open the demo directly without Autodesk sign-in; the demo makes no APS API calls.

## Navigation

| Workspace | Demo experience |
| --- | --- |
| Overview | Sample portfolio KPIs, attention queue, observed activity, favorite tools |
| Projects | Inventory, Project 360, lifecycle review, closeout readiness |
| People & Access | People directory, Person 360, access matrix, folder permission examples, offboarding plans |
| Insights | Tool dashboards, Activity explorer, Governance findings |
| Data | Sample extracts, Data Health, Integration Health |
| Admin | Browser-only bulk simulations, sample provisioning recipe, simulation history |

Global search connects projects, people, and companies. The Saved header control opens browser-local bookmarks and saved filters shared by visitors using that browser profile. Optional external deployment links never switch this build into live mode.

## Thirteen foundational capabilities

| Capability | Behavior in this demo |
| --- | --- |
| People / User 360 | Search sample members and inspect fictional projects, products, roles, companies, and activity |
| Access Matrix | Compare sample membership and access across projects; administrative changes use the separate simulator |
| Offboarding / access cleanup | Inspect a fictional person's associations and open a simulated removal plan |
| Governance | Group sample exceptions and keep personal review decisions locally in the browser |
| Project Health | Inspect activity, membership, workflow, lifecycle, and data indicators from the sample dataset |
| Lifecycle | Review fictional archive candidates and evidence; decisions remain browser-local |
| Permissions | Resolve sample user, role, and company assignments; no APS folder permission is changed |
| Provisioning recipes | Read a sample healthcare standard and try project creation in the simulator |
| Extract scheduling | Inspect fictional schedules and jobs; no extraction or scheduler runs |
| Data Connector Health | Inspect sample coverage, table availability, schema examples, and freshness indicators |
| Portfolio Search | Search the bundled project, person, and company records; no live hub query |
| Saved Views / Watchlists | Save browser-local filters and bookmarks; no automated monitoring or notifications |
| Change Preview / Audit | Configure, preview, confirm, simulate, and inspect results in the current view; no live administrative audit |

## Tool dashboards

All 21 dashboards use sample tables generated from a deterministic fixture generator:

- Activities and Administration.
- Assets, Forms, and Photos.
- Issues, RFIs, Submittals, Meetings, and Reviews.
- IQ and four Quality KPI views: Design & Document Review, Field Quality, Model Coordination, and Model Coordination Clash Report.
- Cost, Cost KPIs, Estimate, and Takeoff.
- Schedule and Schedule KPI.

Dashboard groupings, joins, counts, totals, charts, and CSV exports illustrate a reporting experience; the dataset is not an Autodesk Power BI template validation suite or a customer extract. Some sample records are intentionally incomplete to demonstrate unknown values and exception handling.

Chart labels wrap using normal text, legends retain status names, and time charts provide tabular values. Browser-local favorites appear on Overview.

## Entity views

**Project 360**, **Person 360**, and **Company 360** connect the fictional portfolio. Metrics describe the selected source and observation window. A project member count is assigned membership; active people counts observed activity identities. Neither is a commercial license balance.

## Integration Health and Closeout

Integration Health illustrates schema/migration mapping, extraction inventory, contract impacts, readiness checks, API dependency notices, and semantic trust tests. Closeout illustrates turnover profiles, project evidence, exact document versions, asset relationships, and blocker lists. These are read-only sample assessments. See the [workflow guide](INTEGRATION-HEALTH-AND-CLOSEOUT.md).

## Data provenance

Sample badges and the persistent demo banner identify the origin of portfolio data. Synthetic timestamps can be relative to the fixture clock, so a recent sample date is not evidence that Autodesk was queried. No Autodesk account or verified visitor identity is used.

## Unavailable operations

This build does not upload customer ZIPs, request or ingest real Data Connector jobs, refresh live access, scan real project evidence, modify organization records, run monitors, download Autodesk files, generate handover packages, or record owner acceptance. The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains its live authorization and deployment rules for supported operations.
