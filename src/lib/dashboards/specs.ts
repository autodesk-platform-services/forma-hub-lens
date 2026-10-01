/**
 * Dashboard specs for the 21 Forma tools.
 *
 * Each spec is distilled from the matching Autodesk Power BI template (.pbit):
 * the KPI cards, chart types, titles and grouping fields are taken from that
 * template's primary hub page. Field names are the real Data Connector CSV
 * columns, so a spec resolves directly against an uploaded extract.
 *
 * Facts join to dimensions on `bim360_project_id -> admin_projects.id`,
 * `company_id -> admin_companies.id` and `created_by -> admin_users.autodesk_id`.
 */

export type Agg = "count" | "distinct" | "sum" | "avg" | "min" | "max";

export type Where = {
  column: string;
  equals?: string;
  notEquals?: string;
  in?: string[];
  notNull?: boolean;
  isNull?: boolean;
  /** Compare a date column with the current UTC date. */
  beforeToday?: boolean;
};

export type Kpi = {
  label: string;
  table: string;
  column?: string;
  agg: Agg;
  where?: Where[];
  format?: "int" | "money" | "percent" | "days" | "date";
};

export type ChartKind =
  | "line"
  | "area"
  | "column"
  | "bar"
  | "stackedBar"
  | "donut"
  | "treemap"
  | "table"
  | "scatter";

export type Chart = {
  kind: ChartKind;
  title: string;
  table: string;
  /** Dimension. `table` defaults to the fact table; set it to join a dimension. */
  category?: { table?: string; column: string; bucket?: "month" | "day" };
  value?: { column?: string; agg: Agg };
  series?: { table?: string; column: string };
  where?: Where[];
  limit?: number;
  /** For kind: "table" */
  columns?: Array<{ table?: string; column: string; label: string }>;
  sort?: { column: string; dir: "asc" | "desc" };
  format?: "int" | "money" | "percent" | "days";
};

export type ToolSpec = {
  id: string;
  name: string;
  blurb: string;
  template: string;
  /** Tables that must be present for the tool to light up. */
  requires: string[];
  kpis: Kpi[];
  charts: Chart[];
};

const OPEN_ISSUE = { column: "status", in: ["open", "in_progress", "in_review", "answered"] };

export const TOOL_SPECS: ToolSpec[] = [
  {
    id: "activities",
    name: "Activities",
    blurb: "Audit activity across Docs, Issues, RFIs, Sheets and Admin.",
    template: "data-connector-activities-dashboard-csv-v1-3.pbit",
    requires: ["activities_docs_activities"],
    kpis: [
      { label: "# Activities", table: "activities_docs_activities", column: "activity_id", agg: "count" },
      { label: "# of Active Projects", table: "activities_docs_activities", column: "bim360_project_id", agg: "distinct" },
      { label: "# of Active Users", table: "activities_docs_activities", column: "created_by", agg: "distinct" },
      { label: "Extraction Date", table: "metadata", column: "created_at", agg: "min", format: "date" },
    ],
    charts: [
      { kind: "area", title: "Activities over time", table: "activities_docs_activities", category: { column: "created_at", bucket: "day" }, value: { column: "activity_id", agg: "count" } },
      { kind: "bar", title: "Activities by User", table: "activities_docs_activities", category: { table: "admin_users", column: "name" }, value: { column: "activity_id", agg: "count" }, limit: 12 },
      { kind: "bar", title: "Activities by Project", table: "activities_docs_activities", category: { table: "admin_projects", column: "name" }, value: { column: "activity_id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Activities by Verb", table: "activities_docs_activities", category: { column: "activity_verb" }, value: { column: "activity_id", agg: "count" }, limit: 14 },
      { kind: "donut", title: "Activities by Object Type", table: "activities_docs_activities", category: { column: "object_object_type" }, value: { column: "activity_id", agg: "count" }, limit: 8 },
    ],
  },
  {
    id: "administration",
    name: "Administration",
    blurb: "Users, companies, projects and product access across the hub.",
    template: "data-connector-admin-dashboard-connector-v1-3.pbit",
    requires: ["admin_projects"],
    kpis: [
      { label: "Users", table: "admin_users", column: "id", agg: "count" },
      { label: "Companies", table: "admin_companies", column: "id", agg: "count" },
      { label: "Projects", table: "admin_projects", column: "id", agg: "count" },
      { label: "Active Projects", table: "admin_projects", column: "id", agg: "count", where: [{ column: "status", equals: "active" }] },
    ],
    charts: [
      { kind: "bar", title: "Project members by Project", table: "admin_project_users", category: { table: "admin_projects", column: "name" }, value: { column: "user_id", agg: "distinct" }, limit: 12 },
      { kind: "bar", title: "Users by Company", table: "admin_users", category: { table: "admin_companies", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Companies by Trade", table: "admin_companies", category: { column: "trade" }, value: { column: "id", agg: "count" }, limit: 14 },
      { kind: "donut", title: "Product Access", table: "admin_project_user_products", category: { column: "product_key" }, value: { column: "user_id", agg: "count" }, limit: 10 },
      { kind: "donut", title: "Projects by Status", table: "admin_projects", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "column", title: "Projects by Type", table: "admin_projects", category: { column: "type" }, value: { column: "id", agg: "count" }, limit: 12 },
    ],
  },
  {
    id: "assets",
    name: "Assets",
    blurb: "Asset inventory, categories, statuses and model linkage.",
    template: "data-connector-assets-dashboard-connector-v2-4.pbit",
    requires: ["assets_assets"],
    kpis: [
      { label: "# of Assets", table: "assets_assets", column: "id", agg: "count" },
      { label: "# Asset Categories", table: "assets_categories", column: "id", agg: "count" },
      { label: "Projects with Assets", table: "assets_assets", column: "bim360_project_id", agg: "distinct" },
      { label: "Assets with Barcode", table: "assets_assets", column: "id", agg: "count", where: [{ column: "barcode", notNull: true }] },
    ],
    charts: [
      { kind: "bar", title: "Assets by Project", table: "assets_assets", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Top Asset updaters", table: "assets_assets", category: { table: "admin_users", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "donut", title: "Assets by Category", table: "assets_assets", category: { table: "assets_categories", column: "name" }, value: { column: "id", agg: "count" }, limit: 10 },
      { kind: "column", title: "Assets created over time", table: "assets_assets", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "Assets by Company", table: "assets_assets", category: { table: "admin_companies", column: "name" }, value: { column: "id", agg: "count" }, limit: 10 },
    ],
  },
  {
    id: "cost",
    name: "Cost",
    blurb: "Cost KPIs — contingency, change orders relative to main contract.",
    template: "data-connector-cost-kpis-project-connector-v1-1.pbit",
    requires: ["cost_budgets"],
    kpis: [
      { label: "Original Budget", table: "cost_budgets", column: "original_amount", agg: "sum", format: "money" },
      { label: "Revised Budget", table: "cost_budgets", column: "revised", agg: "sum", format: "money" },
      { label: "Actual Cost", table: "cost_budgets", column: "actual_cost", agg: "sum", format: "money" },
      { label: "Forecast Final Cost", table: "cost_budgets", column: "forecast_final_cost", agg: "sum", format: "money" },
      { label: "Forecast Variance", table: "cost_budgets", column: "forecast_variance", agg: "sum", format: "money" },
    ],
    charts: [
      { kind: "bar", title: "Revised Budget by Project", table: "cost_budgets", category: { table: "admin_projects", column: "name" }, value: { column: "revised", agg: "sum" }, format: "money", limit: 12 },
      { kind: "bar", title: "Change Orders Relative to Main Contract", table: "cost_change_orders", category: { table: "admin_projects", column: "name" }, value: { column: "approved", agg: "sum" }, format: "money", limit: 12 },
      { kind: "scatter", title: "Contingency Usage by Project", table: "cost_budgets", category: { table: "admin_projects", column: "name" }, value: { column: "reserves", agg: "sum" }, format: "money", limit: 20 },
      { kind: "column", title: "Actual Cost over time", table: "cost_budgets", category: { column: "updated_at", bucket: "month" }, value: { column: "actual_cost", agg: "sum" }, format: "money" },
      { kind: "table", title: "Budget Detail", table: "cost_budgets", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "code", label: "Code" },
        { column: "name", label: "Budget" },
        { column: "original_amount", label: "Original" },
        { column: "revised", label: "Revised" },
        { column: "actual_cost", label: "Actual" },
      ], limit: 40 },
    ],
  },
  {
    id: "cost-kpis",
    name: "Cost KPIs",
    blurb: "Budgets, contracts and change orders across the portfolio.",
    template: "data-connector-cost-management-dashboard-connector-v2-3.pbit",
    requires: ["cost_budgets"],
    kpis: [
      { label: "Budgets", table: "cost_budgets", column: "id", agg: "count" },
      { label: "Contracts", table: "cost_contracts", column: "id", agg: "count" },
      { label: "Change Orders", table: "cost_change_orders", column: "id", agg: "count" },
      { label: "Contract Value", table: "cost_contracts", column: "awarded", agg: "sum", format: "money" },
    ],
    charts: [
      { kind: "bar", title: "Budget Trends", table: "cost_budgets", category: { table: "admin_projects", column: "name" }, value: { column: "original_amount", agg: "sum" }, format: "money", limit: 12 },
      { kind: "bar", title: "Cost Trend", table: "cost_budgets", category: { table: "admin_projects", column: "name" }, value: { column: "actual_cost", agg: "sum" }, format: "money", limit: 12 },
      { kind: "donut", title: "Contracts by Status", table: "cost_contracts", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "column", title: "Change Orders by Budget Status", table: "cost_change_orders", category: { column: "budget_status" }, value: { column: "id", agg: "count" }, limit: 10 },
      { kind: "table", title: "Contracts", table: "cost_contracts", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "code", label: "Code" },
        { column: "name", label: "Contract" },
        { column: "status", label: "Status" },
        { column: "awarded", label: "Awarded" },
      ], limit: 40 },
    ],
  },
  {
    id: "estimate",
    name: "Estimate",
    blurb: "Estimation instances, portfolio value and cost breakdown.",
    template: "data-connector-estimate-dashboard-connector-v1-1.pbit",
    requires: ["estimates_estimation_instances"],
    kpis: [
      { label: "Total Estimates", table: "estimates_estimation_instances", column: "id", agg: "count" },
      { label: "Total Portfolio Value", table: "estimates_estimation_instances", column: "total_cost", agg: "sum", format: "money" },
      { label: "Average Total Cost", table: "estimates_estimation_instances", column: "total_cost", agg: "avg", format: "money" },
    ],
    charts: [
      { kind: "donut", title: "Project Status", table: "admin_projects", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "# of Projects by Type", table: "admin_projects", category: { column: "type" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "column", title: "Average Total Cost by Project Type", table: "estimates_estimation_instances", category: { table: "admin_projects", column: "type" }, value: { column: "total_cost", agg: "avg" }, format: "money", limit: 12 },
      { kind: "column", title: "Total Cost Over Time", table: "estimates_estimation_instances", category: { column: "created_at", bucket: "month" }, value: { column: "total_cost", agg: "sum" }, format: "money" },
      { kind: "bar", title: "Estimate value by Project", table: "estimates_estimation_instances", category: { table: "admin_projects", column: "name" }, value: { column: "total_cost", agg: "sum" }, format: "money", limit: 12 },
    ],
  },
  {
    id: "forms",
    name: "Forms",
    blurb: "Form completion, templates and weather logs.",
    template: "data-connector-forms-dashboard-connector-v2-5.pbit",
    requires: ["forms_forms"],
    kpis: [
      { label: "# Forms", table: "forms_forms", column: "id", agg: "count" },
      { label: "# Forms Closed", table: "forms_forms", column: "id", agg: "count", where: [{ column: "status", equals: "closed" }] },
      { label: "Projects with Forms", table: "forms_forms", column: "bim360_project_id", agg: "distinct" },
      { label: "Templates in use", table: "forms_forms", column: "template_id", agg: "distinct" },
    ],
    charts: [
      { kind: "treemap", title: "Forms by Template Type", table: "forms_form_templates", category: { column: "template_type" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "bar", title: "Forms by Project", table: "forms_forms", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "area", title: "Forms over time", table: "forms_forms", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "donut", title: "Forms by Status", table: "forms_forms", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "Forms by Template", table: "forms_forms", category: { table: "forms_form_templates", column: "name" }, value: { column: "id", agg: "count" }, limit: 10 },
    ],
  },
  {
    id: "iq",
    name: "IQ",
    blurb: "Construction IQ — quality, safety and design risk.",
    template: "data-connector-iq-dashboard-connector-v2-5.pbit",
    requires: ["iq_issues_quality_risks"],
    kpis: [
      { label: "Quality Risk Issues", table: "iq_issues_quality_risks", column: "id", agg: "count" },
      { label: "High Quality Risk", table: "iq_issues_quality_risks", column: "id", agg: "count", where: [{ column: "risk", equals: "high" }] },
      { label: "Safety Risk Issues", table: "iq_issues_safety_risk", column: "id", agg: "count" },
      { label: "High-risk RFIs", table: "rfis_high_risk", column: "rfi_id", agg: "count" },
    ],
    charts: [
      { kind: "donut", title: "Quality Risk Distribution", table: "iq_issues_quality_risks", category: { column: "risk" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "# of High/Medium Quality Issues by Project", table: "iq_issues_quality_risks", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, where: [{ column: "risk", in: ["high", "medium"] }], limit: 12 },
      { kind: "column", title: "# of High/Medium Quality Issues by Date", table: "iq_issues_quality_risks", category: { column: "predicted_at", bucket: "month" }, value: { column: "id", agg: "count" }, where: [{ column: "risk", in: ["high", "medium"] }] },
      { kind: "treemap", title: "Safety Hazard Categories", table: "iq_issues_safety_risk", category: { column: "safety_risk_category" }, value: { column: "id", agg: "count" }, limit: 12 },
    ],
  },
  {
    id: "issues",
    name: "Issues",
    blurb: "Issue volume, ageing, root cause and overdue backlog.",
    template: "data-connector-issues-dashboard-connector-v3-4.pbit",
    requires: ["issues_issues"],
    kpis: [
      { label: "Issues", table: "issues_issues", column: "issue_id", agg: "count" },
      { label: "Open", table: "issues_issues", column: "issue_id", agg: "count", where: [OPEN_ISSUE] },
      { label: "Pending", table: "issues_issues", column: "issue_id", agg: "count", where: [{ column: "status", equals: "pending" }] },
      { label: "Closed", table: "issues_issues", column: "issue_id", agg: "count", where: [{ column: "status", equals: "closed" }] },
    ],
    charts: [
      { kind: "treemap", title: "Issues by Root Cause", table: "issues_issues", category: { table: "issues_root_causes", column: "title" }, value: { column: "issue_id", agg: "count" }, limit: 14 },
      { kind: "line", title: "Issues by Month", table: "issues_issues", category: { column: "created_at", bucket: "month" }, value: { column: "issue_id", agg: "count" } },
      { kind: "column", title: "Issues by Project", table: "issues_issues", category: { table: "admin_projects", column: "name" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
      { kind: "donut", title: "Top 5 Issues Across All Projects", table: "issues_issues", category: { table: "issues_issue_types", column: "issue_type" }, value: { column: "issue_id", agg: "count" }, limit: 5 },
      { kind: "table", title: "Top 10 Most Overdue Open Issues", table: "issues_issues", where: [OPEN_ISSUE, { column: "due_date", notNull: true }], columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "display_id", label: "ID" },
        { column: "title", label: "Title" },
        { column: "status", label: "Status" },
        { column: "due_date", label: "Due" },
      ], sort: { column: "due_date", dir: "asc" }, limit: 10 },
    ],
  },
  {
    id: "meetings",
    name: "Meetings",
    blurb: "Meeting minutes, topics, items and participation.",
    template: "data-connector-meeting-minutes-dashboard-connector-v1-2.pbit",
    requires: ["meetingminutes_meetings"],
    kpis: [
      { label: "Meetings", table: "meetingminutes_meetings", column: "id", agg: "count" },
      { label: "Topics", table: "meetingminutes_topics", column: "id", agg: "count" },
      { label: "Items", table: "meetingminutes_items", column: "id", agg: "count" },
      { label: "Participants", table: "meetingminutes_participants", column: "id", agg: "distinct" },
    ],
    charts: [
      { kind: "stackedBar", title: "Meetings by Project", table: "meetingminutes_meetings", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, series: { column: "status" }, limit: 12 },
      { kind: "donut", title: "Total Items by Status", table: "meetingminutes_items", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "stackedBar", title: "Items by Project", table: "meetingminutes_items", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, series: { column: "status" }, limit: 12 },
      { kind: "line", title: "Meetings over time", table: "meetingminutes_meetings", category: { column: "starts_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "table", title: "Meetings", table: "meetingminutes_meetings", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "title", label: "Meeting" },
        { column: "status", label: "Status" },
        { column: "starts_at", label: "Starts" },
        { column: "meeting_location", label: "Location" },
      ], limit: 30 },
    ],
  },
  {
    id: "photos",
    name: "Photos",
    blurb: "Photo capture volume, tags, GPS coverage and contributors.",
    template: "data-connector-photos-dashboard-connector-v1-3.pbit",
    requires: ["photos_photos"],
    kpis: [
      { label: "# Photos", table: "photos_photos", column: "id", agg: "count" },
      { label: "# Photos with GPS data", table: "photos_photos", column: "id", agg: "count", where: [{ column: "lat", notNull: true }] },
      { label: "# Photo Tags", table: "photos_photo_tags", column: "id", agg: "count" },
      { label: "Projects with Photos", table: "photos_photos", column: "bim360_project_id", agg: "distinct" },
    ],
    charts: [
      { kind: "line", title: "# of Photos by Month", table: "photos_photos", category: { column: "taken_on", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "# Photos by Project", table: "photos_photos", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Photos by Type", table: "photos_photos", category: { column: "type" }, value: { column: "id", agg: "count" }, limit: 10 },
      { kind: "donut", title: "Photos by Status", table: "photos_photos", category: { column: "status" }, value: { column: "id", agg: "count" } },
    ],
  },
  {
    id: "quality-ddr",
    name: "Quality KPIs (Design & Document Review)",
    blurb: "Design issue and review throughput against project value.",
    template: "data-connector-design-and-document-review-dashboard-connector-v3-1.pbit",
    requires: ["reviews_reviews"],
    kpis: [
      { label: "Reviews", table: "reviews_reviews", column: "id", agg: "count" },
      { label: "Project Value", table: "admin_projects", column: "value", agg: "sum", format: "money" },
      { label: "Design Issues", table: "issues_issues", column: "issue_id", agg: "count" },
      { label: "Overdue Submittals", table: "submittalsacc_items", column: "id", agg: "count", where: [{ column: "status_value", notEquals: "closed" }, { column: "due_date", beforeToday: true }] },
    ],
    charts: [
      { kind: "column", title: "Design issues over time", table: "issues_issues", category: { column: "created_at", bucket: "month" }, value: { column: "issue_id", agg: "count" } },
      { kind: "column", title: "Overdue submittals trend", table: "submittalsacc_items", category: { column: "due_date", bucket: "month" }, value: { column: "id", agg: "count" }, where: [{ column: "status_value", notEquals: "closed" }, { column: "due_date", beforeToday: true }] },
      { kind: "bar", title: "Reviews by Project", table: "reviews_reviews", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "donut", title: "Review status", table: "reviews_reviews", category: { column: "status" }, value: { column: "id", agg: "count" } },
    ],
  },
  {
    id: "quality-field",
    name: "Quality KPIs (Field Quality)",
    blurb: "Field issue rates, forms with issues and quality trend.",
    template: "data-connector-field-quality-control-connector-v1-4.pbit",
    requires: ["issues_issues"],
    kpis: [
      { label: "Field Issues", table: "issues_issues", column: "issue_id", agg: "count" },
      { label: "Open Field Issues", table: "issues_issues", column: "issue_id", agg: "count", where: [OPEN_ISSUE] },
      { label: "Forms", table: "forms_forms", column: "id", agg: "count" },
      { label: "Project Value", table: "admin_projects", column: "value", agg: "sum", format: "money" },
    ],
    charts: [
      { kind: "line", title: "Issues per month", table: "issues_issues", category: { column: "created_at", bucket: "month" }, value: { column: "issue_id", agg: "count" } },
      { kind: "column", title: "Forms with issues", table: "forms_forms", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "Issues by Project", table: "issues_issues", category: { table: "admin_projects", column: "name" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Issues by Root Cause", table: "issues_issues", category: { table: "issues_root_causes", column: "title" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
    ],
  },
  {
    id: "quality-mc",
    name: "Quality KPIs (Model Coordination)",
    blurb: "Clash report overview across coordinated models.",
    template: "data-connector-quality-kpis-model-coordination-clash-report-connector-v1-2.pbit",
    requires: ["issues_issues"],
    kpis: [
      { label: "Coordination Issues", table: "issues_issues", column: "issue_id", agg: "count" },
      { label: "Open", table: "issues_issues", column: "issue_id", agg: "count", where: [OPEN_ISSUE] },
      { label: "Closed", table: "issues_issues", column: "issue_id", agg: "count", where: [{ column: "status", equals: "closed" }] },
      { label: "Projects", table: "issues_issues", column: "bim360_project_id", agg: "distinct" },
    ],
    charts: [
      { kind: "column", title: "Coordination issues by month", table: "issues_issues", category: { column: "created_at", bucket: "month" }, value: { column: "issue_id", agg: "count" } },
      { kind: "bar", title: "Issues by Project", table: "issues_issues", category: { table: "admin_projects", column: "name" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
      { kind: "donut", title: "Issues by Status", table: "issues_issues", category: { column: "status" }, value: { column: "issue_id", agg: "count" } },
      { kind: "treemap", title: "Issues by Type", table: "issues_issues", category: { table: "issues_issue_types", column: "issue_type" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
    ],
  },
  {
    id: "quality-mc-clash",
    name: "Quality KPIs (Model Coordination Clash Report)",
    blurb: "Model coordination issue detail by project and assignee.",
    template: "data-connector-quality-kpis-model-coordination-dashboard-connector-v1-3.pbit",
    requires: ["issues_issues"],
    kpis: [
      { label: "Clash Issues", table: "issues_issues", column: "issue_id", agg: "count" },
      { label: "Open", table: "issues_issues", column: "issue_id", agg: "count", where: [OPEN_ISSUE] },
      { label: "Assignees", table: "issues_issues", column: "assignee_id", agg: "distinct" },
      { label: "Projects", table: "issues_issues", column: "bim360_project_id", agg: "distinct" },
    ],
    charts: [
      { kind: "bar", title: "Issues by Project", table: "issues_issues", category: { table: "admin_projects", column: "name" }, value: { column: "issue_id", agg: "count" }, limit: 12 },
      { kind: "line", title: "Issues created by month", table: "issues_issues", category: { column: "created_at", bucket: "month" }, value: { column: "issue_id", agg: "count" } },
      { kind: "donut", title: "Issues by Status", table: "issues_issues", category: { column: "status" }, value: { column: "issue_id", agg: "count" } },
      { kind: "table", title: "Clash Report", table: "issues_issues", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "display_id", label: "ID" },
        { column: "title", label: "Title" },
        { column: "status", label: "Status" },
        { column: "created_at", label: "Created" },
      ], limit: 30 },
    ],
  },
  {
    id: "reviews",
    name: "Reviews",
    blurb: "Review workflows, approvals and time to close.",
    template: "data-connector-reviews-dashboard-connector-v1-4.pbit",
    requires: ["reviews_reviews"],
    kpis: [
      { label: "Total Reviews", table: "reviews_reviews", column: "id", agg: "count" },
      { label: "Total Reviews Open", table: "reviews_reviews", column: "id", agg: "count", where: [{ column: "status", equals: "OPEN" }] },
      { label: "Total Reviews Closed", table: "reviews_reviews", column: "id", agg: "count", where: [{ column: "status", equals: "CLOSED" }] },
      { label: "Docs in review", table: "reviews_reviews", column: "docs_count", agg: "sum" },
    ],
    charts: [
      { kind: "line", title: "Reviews created over time", table: "reviews_reviews", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "stackedBar", title: "Reviews by Project Name and Status", table: "reviews_reviews", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, series: { column: "status" }, limit: 12 },
      { kind: "donut", title: "Reviews by Status", table: "reviews_reviews", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "column", title: "Approved documents by Project", table: "reviews_reviews", category: { table: "admin_projects", column: "name" }, value: { column: "approved_count", agg: "sum" }, limit: 12 },
    ],
  },
  {
    id: "rfis",
    name: "RFIs",
    blurb: "RFI volume, status, discipline and response times.",
    template: "data-connector-rfis-dashboard-connector-v1-10.pbit",
    requires: ["rfis_rfis"],
    kpis: [
      { label: "# of Total RFI's", table: "rfis_rfis", column: "id", agg: "count" },
      { label: "# of Open RFI's", table: "rfis_rfis", column: "id", agg: "count", where: [{ column: "status", in: ["open", "submitted", "answered"] }] },
      { label: "# of Draft RFI's", table: "rfis_rfis", column: "id", agg: "count", where: [{ column: "status", equals: "draft" }] },
      { label: "# of Closed RFI's", table: "rfis_rfis", column: "id", agg: "count", where: [{ column: "status", equals: "closed" }] },
    ],
    charts: [
      { kind: "line", title: "# of RFI's by Month", table: "rfis_rfis", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "treemap", title: "# of RFI's by Category", table: "rfis_category", category: { column: "category" }, value: { column: "rfi_id", agg: "count" }, limit: 12 },
      { kind: "donut", title: "# RFIs by Status", table: "rfis_rfis", category: { column: "status" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "# of RFI's by Discipline", table: "rfis_discipline", category: { column: "discipline" }, value: { column: "rfi_id", agg: "count" }, limit: 12 },
      { kind: "table", title: "RFI Log", table: "rfis_rfis", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "custom_identifier", label: "ID" },
        { column: "title", label: "Title" },
        { column: "status", label: "Status" },
        { column: "due_date", label: "Due" },
      ], limit: 30 },
    ],
  },
  {
    id: "schedule",
    name: "Schedule",
    blurb: "Schedules, revisions, activities and critical path load.",
    template: "data-connector-schedule-dashboard-connector-v2-5.pbit",
    requires: ["schedule_activities"],
    kpis: [
      { label: "Schedules", table: "schedule_schedules", column: "id", agg: "count" },
      { label: "Revisions", table: "schedule_schedules", column: "version_number", agg: "sum" },
      { label: "Activities", table: "schedule_activities", column: "id", agg: "count" },
      { label: "Critical path activities", table: "schedule_activities", column: "id", agg: "count", where: [{ column: "is_critical_path", in: ["t", "true", "TRUE", "1"] }] },
    ],
    charts: [
      { kind: "area", title: "Schedule revisions over time", table: "schedule_schedules", category: { column: "updated_at", bucket: "month" }, value: { column: "version_number", agg: "sum" } },
      { kind: "donut", title: "Schedules by Type", table: "schedule_schedules", category: { column: "type" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "Activities by Project", table: "schedule_activities", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "treemap", title: "Activities by Type", table: "schedule_activities", category: { column: "type" }, value: { column: "id", agg: "count" }, limit: 10 },
    ],
  },
  {
    id: "schedule-kpi",
    name: "Schedule KPI",
    blurb: "Schedule performance, delays and milestone risk.",
    template: "data-connector-schedule-kpi-dashboard-connector-v1-2.pbit",
    requires: ["schedule_activities"],
    kpis: [
      { label: "Activities", table: "schedule_activities", column: "id", agg: "count" },
      { label: "Critical path", table: "schedule_activities", column: "id", agg: "count", where: [{ column: "is_critical_path", in: ["t", "true", "TRUE", "1"] }] },
      { label: "Milestones", table: "schedule_activities", column: "id", agg: "count", where: [{ column: "type", equals: "Milestone" }] },
      { label: "Avg completion %", table: "schedule_activities", column: "completion_percentage", agg: "avg", format: "percent" },
    ],
    charts: [
      { kind: "bar", title: "Critical path activities by Project", table: "schedule_activities", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, where: [{ column: "is_critical_path", in: ["t", "true", "TRUE", "1"] }], limit: 12 },
      { kind: "column", title: "Activity completion by Project", table: "schedule_activities", category: { table: "admin_projects", column: "name" }, value: { column: "completion_percentage", agg: "avg" }, format: "percent", limit: 12 },
      { kind: "donut", title: "Activities by Type", table: "schedule_activities", category: { column: "type" }, value: { column: "id", agg: "count" }, limit: 8 },
      { kind: "line", title: "Planned finishes by month", table: "schedule_activities", category: { column: "planned_finish", bucket: "month" }, value: { column: "id", agg: "count" } },
    ],
  },
  {
    id: "submittals",
    name: "Submittals",
    blurb: "Submittal pipeline, responses, ageing and type mix.",
    template: "data-connector-submittals-dashboard-connector-v3-4.pbit",
    requires: ["submittalsacc_items"],
    kpis: [
      { label: "Submittals", table: "submittalsacc_items", column: "id", agg: "count" },
      { label: "Open", table: "submittalsacc_items", column: "id", agg: "count", where: [{ column: "status_value", in: ["open", "In Review", "Submitted"] }] },
      { label: "Draft", table: "submittalsacc_items", column: "id", agg: "count", where: [{ column: "status_value", equals: "Draft" }] },
      { label: "Closed", table: "submittalsacc_items", column: "id", agg: "count", where: [{ column: "status_value", equals: "Closed" }] },
    ],
    charts: [
      { kind: "line", title: "# Submittals by Month", table: "submittalsacc_items", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "stackedBar", title: "# Submittals by Status", table: "submittalsacc_items", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, series: { column: "status_value" }, limit: 12 },
      { kind: "column", title: "Submittal Responses", table: "submittalsacc_items", category: { column: "response_value" }, value: { column: "id", agg: "count" }, limit: 10 },
      { kind: "treemap", title: "Submittals by Type", table: "submittalsacc_items", category: { column: "type_value" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "table", title: "Longest Running Submittals", table: "submittalsacc_items", columns: [
        { table: "admin_projects", column: "name", label: "Project" },
        { column: "identifier", label: "ID" },
        { column: "title", label: "Title" },
        { column: "status_value", label: "Status" },
        { column: "created_at", label: "Created" },
      ], sort: { column: "created_at", dir: "asc" }, limit: 15 },
    ],
  },
  {
    id: "takeoff",
    name: "Takeoff",
    blurb: "Takeoff packages, items and classification coverage.",
    template: "data-connector-takeoff-dashboard-csv-v1-1.pbit",
    requires: ["takeoff_takeoff_items"],
    kpis: [
      { label: "Takeoff items", table: "takeoff_takeoff_items", column: "id", agg: "count" },
      { label: "Packages", table: "takeoff_packages", column: "id", agg: "count" },
      { label: "Projects with Takeoff", table: "takeoff_takeoff_items", column: "bim360_project_id", agg: "distinct" },
      { label: "Classification systems", table: "takeoff_classification_systems", column: "id", agg: "count" },
    ],
    charts: [
      { kind: "bar", title: "Takeoffs by takeoff packages", table: "takeoff_takeoff_items", category: { table: "takeoff_packages", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
      { kind: "column", title: "# of projects by takeoff classification", table: "takeoff_classification_systems", category: { column: "name" }, value: { column: "bim360_project_id", agg: "distinct" }, limit: 12 },
      { kind: "line", title: "Takeoff items created over time", table: "takeoff_takeoff_items", category: { column: "created_at", bucket: "month" }, value: { column: "id", agg: "count" } },
      { kind: "bar", title: "Takeoff items by Project", table: "takeoff_takeoff_items", category: { table: "admin_projects", column: "name" }, value: { column: "id", agg: "count" }, limit: 12 },
    ],
  },
];

export function specById(id: string): ToolSpec | undefined {
  return TOOL_SPECS.find((spec) => spec.id === id);
}
