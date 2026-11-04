# Integration Health and Closeout workflows

This public demo uses **fictional evidence** to show how integration readiness and project turnover can work. It does not contact a customer pipeline, retrieve live Autodesk schema or project data, run scheduled monitoring, or deliver a real handover package.

## Integration Health

Open **Data → Integration Health** for seeded consumer manifests and sample readiness results.

### Schema and migration map

The sample models mixed project states for Takeoff/Estimate classifications and content references. It illustrates the importance of determining a project's own model state, preserving unknown evidence, and inspecting migration impact across projects.

The demo does not determine the current migration state of any Autodesk project. Do not use fixture notices or dates as an authoritative migration schedule; consult [Autodesk Data Connector guidance](https://help.autodesk.com/view/BUILD/ENU/) and the [APS Data Connector documentation](https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/data-connector/).

### Extraction inventory and trust tests

Sample jobs, service groups, coverage, row counts, and field populations demonstrate checks for:

- Expected versus observed project coverage.
- Required service groups.
- Extract freshness and failed jobs.
- Missing fields and type changes.
- Null-population changes and unusual row-count drops.
- Classification relationships and unresolved references.

A job completing successfully does not prove that its output satisfies a consumer's contract. The example assessments distinguish failures, items requiring review, and unknown evidence.

### Consumer contract and API change watch

Open a sample consumer to inspect declared table, field, capability, and API dependencies. Impact examples connect these declarations to bundled schema and deprecation notices. These are teaching fixtures, not a live APS change feed or a scan of downstream code.

Manifests and stored sample checks are immutable in this public deployment. New manifests, baseline capture, public-feed capture, and monitor settings are unavailable. This demo does not run the live app's in-process scheduler, including when hosted in a long-lived Dokku container.

## Closeout Readiness

Open **Projects → Closeout** and choose a sample project. The seeded turnover profile demonstrates how a project record can be reviewed against required deliverables and evidence.

### Readiness and exact exceptions

Inspect passed checks, warnings, blockers, and unknown sources. Follow an exception to its fictional underlying record rather than relying on a readiness percentage alone. Absence, incomplete coverage, and explicitly unmet requirements have different meanings.

### Evidence and deliverables

The sample covers Files, Assets, Issues, Forms, Submittals, Reviews, and related domains where fixture evidence is available. Source panels show the sample's coverage and limitations. Evidence records are not real Autodesk objects and are not linked to customer documents.

A sample record-document selection identifies an exact file version and illustrates why approval evidence must apply to that version. It contains metadata only, not an Autodesk file binary.

### Asset-centric handover

Sample assets connect location, identifiers, required attributes, documents, forms, issue/RFI references, and other evidence where provided. These examples demonstrate how an asset index could support operational handover without becoming a facility-management system.

### Package and acceptance boundary

The public demo does **not** generate packages, retrieve files, validate downloaded binaries, distribute transmittals, record acceptance, or create a durable closeout history. Profiles, evidence, selections, and relationships are immutable examples. A displayed readiness result cannot establish actual project completion or owner acceptance.

In the live architecture, a package requires authenticated retrieval of exact file versions, version-specific approval evidence, explicit missing-file exceptions, structured indexes, and deliberate acceptance. Consult the separate [live source on `main`](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) for that implementation.

## Source distinction

This deployment requires no Autodesk sign-in and makes no APS API calls. Every portfolio record, integration, schema snapshot, extraction, turnover requirement, and assessment result comes from the demo fixture dataset. No ongoing background checks or notifications are created.
