# Admin usability cleanup

## Navigation and dashboards

- The header groups the workspace into six primary areas and keeps search and saved items available globally.
- All 21 tool dashboards use the updated chart components. Category labels wrap at normal HTML text sizes; counts and status legends remain visible. Issues root causes and RFI categories use readable ranked/share layouts. Time charts keep fixed-size text, show the latest 60 periods, and expose a table containing all returned values.
- Long table labels wrap. A single-category donut remains visible, and a single-status stacked chart still names the status. Tool deep links react to navigation and clear when the dashboard closes.

## Project inventory

**Project members** is the assigned membership count from synced administration data. **Active people (observed)** is the distinct activity-identity count in the ingested window, including unresolved identities. These measure different things.

Sorting now offers project name, status, most/fewest members, newest/oldest observed activity, no observed activity first, event volume, observed people, observed services, and sheet count. Missing counts/dates sort after known values. No observed activity is limited to the ingested window and does not establish inactivity.

## Checkbox selection

Project selectors in Add/Remove members, Archive, Activity, and one-time/recurring Extracts use left-hand checkboxes and **Select all shown**. Filtering preserves selected IDs outside the visible list. Clear-all and selection counts are available. UI limits match the 50-project action/request limits. Filtering with Enter does not submit the action form.

Product and service-group choices also have Select all/Clear controls. The optional new-member role picker uses checkboxes with a 20-role limit.

The remaining item lists in recipe product presets, schema capture service groups, and closeout profile evidence domains also have Select all/Clear. Package acceptance retains unchecked, required exception acknowledgments and offers an explicit Acknowledge all listed exceptions control.

## Companies, roles, and people

- Companies: searchable/filterable live directory, Company profile links, and create/edit for supported name, trade, website, ERP ID, and description fields. Changes require a session-bound, single-use, ten-minute stored preview followed by explicit confirmation. Execution rechecks live duplicate names and changed fields, sends a write once, verifies by readback when available, and records the outcome in the administrative audit. Blank optional edit fields preserve existing values.
- Roles: searchable snapshot inventory, status filters, project/person drill-through, and CSV exports. Role assignment during new-member import is offered only for complete, trusted APS role definitions covering the selected projects. Definitions are checked again at execution. Existing members are skipped; their roles are not changed by the add-members workflow. Asynchronous imports remain marked submitted, rather than verified.
- People directory: company names link to Company profiles. Exact ID matches are resolved in a batched lookup; unresolved IDs may use a labeled live fallback. Duplicate IDs are not assigned arbitrary names. The company snapshot's import time and completeness appear in the source panel. Unresolved names remain labeled Unknown company with the ID underneath.

Company operations follow Autodesk's published [Account Admin OpenAPI](https://github.com/autodesk-platform-services/aps-sdk-openapi/blob/main/construction/accountadmin/accountadmin.yaml), including its regional header and snake_case company payload fields.

## Subscription availability

Product choices retain their appearance and do not show inferred seat balances, as requested when reliable balances cannot be retrieved. Project access counts are not commercial subscription balances. Autodesk exposes account/team subscription reporting through the separate [Business Success Plan Reporting API](https://aps.autodesk.com/developer/overview/business-success-plan-reporting-api); verified reporting access and SKU mapping have not been configured for this app.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build` after changing these flows. The company action tests use mocked APS responses and do not perform live company or membership mutations.
