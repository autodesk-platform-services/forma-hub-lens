/** Synthetic Data Connector rows shared by the demo seed and sample ZIP CLI. No I/O. */

function rnd(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
/** Generate the complete, deterministic sample extract at the requested clock time. */
export function sampleExtractTables(now = Date.now()): Record<string, Array<Record<string, string | number>>> {
const r = rnd(424242);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];

const ACCOUNT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const iso = (daysAgo: number) =>
  new Date(now - daysAgo * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

const PROJECT_NAMES = [
  "Riverside Medical Center", "Northgate Transit Hub", "Halcyon Data Center Ph2",
  "Belmont Bridge Replacement", "Kestrel Distribution Warehouse", "Marlow Street Housing",
  "Corvus Wind Farm", "Ashford Campus Library",
];
const TYPES = ["Hospital", "Transportation Building", "Data Center", "Bridge",
  "Warehouse (non-manufacturing)", "Multi-Family Housing", "Wind Farm", "Library"];
const PEOPLE = [
  ["Priya Raghunathan", "priya.raghunathan@example.com"],
  ["Tomas Lindqvist", "tomas.lindqvist@example.com"],
  ["Amara Okonkwo", "amara.okonkwo@example.com"],
  ["Wei Zhang", "wei.zhang@example.com"],
  ["Devin Cross", "devin.cross@example.com"],
  ["Sofia Marchetti", "sofia.marchetti@example.com"],
];
const TRADES = ["Structural", "Mechanical", "Electrical", "Civil", "Architectural"];

const projects = PROJECT_NAMES.map((name, i) => ({
  bim360_account_id: ACCOUNT,
  id: `p${i}0000-0000-4000-8000-00000000000${i}`,
  name,
  type: TYPES[i],
  status: i === 6 ? "archived" : i === 7 ? "pending" : "active",
  value: 5_000_000 + i * 3_100_000,
  currency: "USD",
  job_number: `JOB-${1000 + i}`,
  city: "Portland",
  country: "United States",
  start_date: iso(600),
  end_date: iso(-200),
  created_at: iso(620),
  updated_at: iso(i),
  last_sign_in: iso(i * 3),
  total_member_size: 20 + i * 9,
  total_company_size: 3 + i,
  classification: "production",
}));

const users = PEOPLE.map(([name, email], i) => ({
  bim360_account_id: ACCOUNT,
  id: `u${i}0000-0000-4000-8000-00000000000${i}`,
  autodesk_id: `ADSK${i}${i}${i}${i}`,
  name,
  email,
  first_name: name.split(" ")[0],
  last_name: name.split(" ")[1],
  status: "active",
  job_title: pick(["Project Engineer", "BIM Manager", "Superintendent", "Estimator"]),
  created_at: iso(500),
  updated_at: iso(i),
  last_sign_in: iso(i),
  default_company_id: `c${i % 4}0000-0000-4000-8000-00000000000${i % 4}`,
}));

const companies = TRADES.slice(0, 4).map((trade, i) => ({
  bim360_account_id: ACCOUNT,
  id: `c${i}0000-0000-4000-8000-00000000000${i}`,
  name: `${trade} Partners LLC`,
  trade,
  city: "Portland",
  country: "United States",
  status: "active",
  project_size: 2 + i,
  user_size: 4 + i,
  created_at: iso(480),
}));

const P = () => pick(projects).id;
const U = () => pick(users);

function many<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

const tables: Record<string, Array<Record<string, string | number>>> = {};
const add = (name: string, rows: Array<Record<string, string | number>>) => {
  tables[name.replace(/\.csv$/i, "")] = rows;
};

add("metadata.csv", [
  { created_at: iso(0), region: "US", request_start_date: iso(90), request_end_date: iso(0) },
]);
add("admin_projects.csv", projects);
add("admin_users.csv", users);
add("admin_companies.csv", companies);
const membershipCounts = [6, 5, 4, 5, 3, 6, 3, 4];
const memberships = projects.flatMap((project, projectIndex) =>
  users.slice(0, membershipCounts[projectIndex]).map((u, userIndex) => ({
    bim360_project_id: project.id,
    bim360_account_id: ACCOUNT,
    user_id: u.id,
    status: "active",
    company_id: u.default_company_id,
    access_level: userIndex === 0 ? "admin" : "member",
    created_at: iso(200 - projectIndex * users.length - userIndex),
    updated_at: iso((projectIndex * users.length + userIndex) % 30),
  })));
add("admin_project_users.csv", memberships);
const productKeys = ["docs", "build", "designCollaboration", "modelCoordination", "takeoff", "cost"];
add("admin_project_user_products.csv", many(70, (i) => ({
  bim360_project_id: memberships[i % memberships.length].bim360_project_id,
  bim360_account_id: ACCOUNT,
  user_id: memberships[i % memberships.length].user_id,
  product_key: productKeys[(i + Math.floor(i / memberships.length)) % productKeys.length],
  access_level: i % 8 === 0 ? "administrator" : "member",
  created_at: iso(150 - (i % 100)),
})));
add("admin_project_roles.csv", many(10, (i) => ({
  bim360_account_id: ACCOUNT,
  bim360_project_id: projects[i % projects.length].id,
  role_oxygen_id: `ro${i}`,
  name: pick(["Project Manager", "Architect", "Engineer", "Subcontractor", "Owner"]),
  status: "active",
  role_id: `role-${i % 5}`,
})));

const ISSUE_STATUS = ["open", "closed", "pending", "in_review"];
add("issues_issue_types.csv", many(5, (i) => ({
  issue_type_id: `it${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  issue_type: pick(["Design", "Safety", "Quality", "Commissioning", "Warranty"]),
  is_active: "t", created_at: iso(300),
})));
add("issues_root_cause_categories.csv", many(4, (i) => ({
  root_cause_category_id: `rcc${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  root_cause_category: pick(["Design", "Workmanship", "Material", "Coordination"]),
})));
add("issues_root_causes.csv", many(6, (i) => ({
  root_cause_id: `rc${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  root_cause_category_id: `rcc${i % 4}`,
  title: pick(["Incomplete drawings", "Clash not resolved", "Wrong material", "Late RFI", "Sequencing", "Spec gap"]),
  is_active: "t", created_at: iso(280),
})));
add("issues_issues.csv", many(420, (i) => {
  const created = 1 + Math.floor(r() * 180);
  return {
    issue_id: `iss-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    display_id: 1000 + i,
    title: `Issue ${1000 + i}: ${pick(["Duct clash", "Missing hanger", "Rebar spacing", "Door swing", "Slab penetration"])}`,
    type_id: `it${i % 5}`, subtype_id: `st${i % 3}`,
    status: pick(ISSUE_STATUS),
    assignee_id: U().id, assignee_type: "user",
    due_date: iso(created - 30), root_cause_id: `rc${i % 6}`,
    root_cause_category_id: `rcc${i % 4}`,
    opened_by: U().autodesk_id, opened_at: iso(created),
    created_by: U().autodesk_id, created_at: iso(created),
    updated_by: U().autodesk_id, updated_at: iso(Math.max(0, created - 10)),
    published: "t",
  };
}));

add("rfis_rfis.csv", many(180, (i) => {
  const created = 1 + Math.floor(r() * 170);
  return {
    id: `rfi-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    custom_identifier: `RFI-${200 + i}`,
    title: `RFI ${200 + i}: ${pick(["Beam penetration", "Finish schedule", "Grounding detail", "Curtain wall"])}`,
    status: pick(["open", "closed", "draft", "answered", "submitted"]),
    due_date: iso(created - 14), created_by: U().autodesk_id, created_at: iso(created),
    updated_at: iso(Math.max(0, created - 5)),
    cost_impact: pick(["Yes", "No"]), schedule_impact: pick(["Yes", "No"]),
    priority: pick(["Low", "Normal", "High"]), rfi_type: pick(["Design", "Field"]),
  };
}));
add("rfis_category.csv", many(180, (i) => ({
  rfi_id: `rfi-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  category: pick(["Architectural", "Structural", "MEP", "Civil", "Other"]),
})));
add("rfis_discipline.csv", many(180, (i) => ({
  rfi_id: `rfi-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  discipline: pick(["Mechanical", "Electrical", "Plumbing", "Structural", "Architectural"]),
})));
add("rfis_high_risk.csv", many(30, (i) => ({
  rfi_id: `rfi-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  risk: "high", updated_at: iso(i),
})));

add("submittalsacc_items.csv", many(220, (i) => {
  const created = 1 + Math.floor(r() * 175);
  return {
    id: `sub-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    spec_identifier: `03 30 00`, title: `Submittal ${300 + i}`,
    type_value: pick(["Product Data", "Shop Drawing", "Sample", "Mock-up"]),
    status_value: pick(["Draft", "Open", "In Review", "Closed", "Submitted"]),
    response_value: pick(["Approved", "Approved as Noted", "Revise and Resubmit", "Rejected"]),
    identifier: `S-${300 + i}`, due_date: iso(created - 21),
    created_by: U().autodesk_id, created_at: iso(created), updated_at: iso(Math.max(0, created - 4)),
    package_title: `Package ${1 + (i % 6)}`, priority_value: pick(["Low", "Normal", "High"]),
  };
}));

add("forms_form_templates.csv", many(6, (i) => ({
  id: `ft${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  name: pick(["Daily Report", "Safety Walk", "Pre-pour", "QA Checklist", "Toolbox Talk", "Punch"]),
  template_type: pick(["pdf", "native", "checklist"]), created_at: iso(300),
})));
add("forms_forms.csv", many(200, (i) => {
  const created = 1 + Math.floor(r() * 170);
  return {
    id: `form-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    template_id: `ft${i % 6}`, status: pick(["closed", "inProgress", "inReview"]),
    assignee_id: U().id, assignee_type: pick(["user", "company", "role"]),
    number: 100 + i, form_date: iso(created),
    created_by: U().autodesk_id, created_at: iso(created), updated_at: iso(Math.max(0, created - 2)),
    name: `Form ${100 + i}`,
  };
}));
add("forms_weather.csv", many(40, (i) => ({
  id: `w${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  temperature_high: 60 + Math.round(r() * 30), temperature_low: 40 + Math.round(r() * 15),
  precipitation_accumulation: (r() * 2).toFixed(2), created_at: iso(i),
})));

add("reviews_reviews.csv", many(140, (i) => {
  const created = 1 + Math.floor(r() * 160);
  return {
    id: `rev-${i}`, sequence_id: i, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    workflow_id: `wf${i % 4}`, status: pick(["OPEN", "CLOSED", "VOID"]),
    review_name: `Review ${400 + i}`, created_by: U().autodesk_id,
    next_due_date: iso(created - 10), created_at: iso(created), updated_at: iso(Math.max(0, created - 3)),
    docs_count: 1 + Math.floor(r() * 12), approved_count: Math.floor(r() * 8),
    rejected_count: Math.floor(r() * 3), workflow_name: pick(["1-step", "2-step", "3-step"]),
  };
}));

add("photos_photos.csv", many(260, (i) => {
  const created = 1 + Math.floor(r() * 170);
  const gps = r() > 0.45;
  return {
    id: `ph-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    title: `IMG_${2000 + i}.jpg`, size: 1_200_000 + i * 900, status: pick(["active", "archived"]),
    creator_id: U().id, lat: gps ? (45.5 + r()).toFixed(5) : "", lng: gps ? (-122.6 - r()).toFixed(5) : "",
    uid: `uid-${i}`, type: pick(["NORMAL", "PANORAMA", "VIDEO"]), image_type: "jpg",
    taken_on: iso(created), created_at: iso(created), updated_on: iso(Math.max(0, created - 1)),
    is_public: "t",
  };
}));
add("photos_photo_tags.csv", many(300, (i) => ({
  id: `pt-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  photo_id: `ph-${i % 260}`, tag: pick(["concrete", "safety", "rework", "progress", "delivery"]),
  created_at: iso(i % 90),
})));

add("assets_categories.csv", many(6, (i) => ({
  id: `ac${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  name: pick(["HVAC", "Electrical", "Plumbing", "Fire", "Elevator", "Envelope"]),
  created_at: iso(320),
})));
add("assets_assets.csv", many(190, (i) => ({
  id: `as-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  client_asset_id: `AS-${5000 + i}`, description: `Asset ${5000 + i}`,
  category_id: `ac${i % 6}`, status_id: `st${i % 3}`, company_id: pick(companies).id,
  barcode: r() > 0.4 ? `BC${10000 + i}` : "",
  created_by: U().autodesk_id, created_at: iso(1 + Math.floor(r() * 170)),
  updated_by: U().autodesk_id, updated_at: iso(Math.floor(r() * 40)),
  "Category Name": pick(["HVAC", "Electrical", "Plumbing", "Fire", "Elevator", "Envelope"]),
})));

add("schedule_schedules.csv", many(14, (i) => ({
  id: `sch-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  name: `Schedule Rev ${i}`, type: pick(["Baseline", "Working", "Actual"]),
  is_public: "t", created_by: U().autodesk_id, created_at: iso(200 - i * 8),
  updated_at: iso(60 - i * 4), version_number: 1 + (i % 5),
})));
add("schedule_activities.csv", many(320, (i) => ({
  id: `act-${i}`, schedule_id: `sch-${i % 14}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  unique_id: `uq-${i}`, name: `Activity ${i}`, type: pick(["Task", "Milestone", "WBS"]),
  is_critical_path: r() > 0.72 ? "t" : "f",
  completion_percentage: Math.round(r() * 100),
  planned_start: iso(180 - (i % 170)), planned_finish: iso(150 - (i % 140)),
  actual_start: iso(178 - (i % 170)), actual_finish: iso(145 - (i % 140)),
  duration: 1 + Math.floor(r() * 40),
  "Activity Status": pick(["Not Started", "In Progress", "Complete", "Delayed"]),
  "Is Delayed Start": r() > 0.7 ? "t" : "f", "Is Delayed Finish": r() > 0.75 ? "t" : "f",
  "Days Delayed Start": Math.floor(r() * 12), "Days Delayed Finish": Math.floor(r() * 15),
  created_at: iso(200), updated_at: iso(20),
})));

add("takeoff_packages.csv", many(9, (i) => ({
  id: `tp${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  name: `Takeoff Package ${i + 1}`, created_at: iso(150 - i * 8), updated_at: iso(20),
})));
add("takeoff_takeoff_items.csv", many(240, (i) => ({
  id: `ti-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  content_lineage_id: `cl${i % 20}`, content_version: 1, package_id: `tp${i % 9}`,
  type_id: `tt${i % 5}`, object_name: pick(["Wall", "Slab", "Column", "Beam", "Duct"]),
  created_at: iso(1 + Math.floor(r() * 150)), updated_at: iso(Math.floor(r() * 30)),
})));
add("takeoff_classification_systems.csv", many(4, (i) => ({
  id: `cs${i}`, bim360_account_id: ACCOUNT, bim360_project_id: projects[i].id,
  name: pick(["Uniformat", "MasterFormat", "OmniClass", "Custom"]), created_at: iso(200),
})));

add("meetingminutes_meetings.csv", many(46, (i) => ({
  id: `mtg-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  series_id: `ser${i % 5}`, title: `Weekly Coordination #${i + 1}`,
  status: pick(["open", "closed", "draft"]), num_in_series: i % 12,
  meeting_location: pick(["Site Trailer", "Teams", "Room 2A"]),
  starts_at: iso(1 + Math.floor(r() * 160)), duration: 60,
  created_by: U().autodesk_id, created_at: iso(1 + Math.floor(r() * 160)), updated_at: iso(5),
})));
add("meetingminutes_topics.csv", many(90, (i) => ({
  id: `top-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  meeting_id: `mtg-${i % 46}`, name: `Topic ${i}`, created_at: iso(i % 120),
})));
add("meetingminutes_items.csv", many(150, (i) => ({
  id: `mi-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  topic_id: `top-${i % 90}`, order_index: i % 8, description: `Action item ${i}`,
  status: pick(["open", "closed", "ongoing"]), due_date: iso(30 - (i % 30)),
  created_by: U().autodesk_id, created_at: iso(i % 140), updated_at: iso(i % 20),
})));
add("meetingminutes_participants.csv", many(120, (i) => ({
  id: `mp-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  meeting_id: `mtg-${i % 46}`, user_id: users[i % users.length].id,
  status: "accepted", created_at: iso(i % 120),
})));

add("cost_budgets.csv", many(80, (i) => ({
  bim360_account_id: ACCOUNT, bim360_project_id: P(), id: `bud-${i}`,
  code: `01-${100 + i}`, name: `Budget line ${i}`,
  quantity: 1 + Math.floor(r() * 50), unit_price: 1000 + Math.floor(r() * 8000), unit: "EA",
  original_amount: 100_000 + Math.floor(r() * 900_000),
  approved_change_orders: Math.floor(r() * 90_000),
  pending_change_orders: Math.floor(r() * 40_000),
  reserves: Math.floor(r() * 60_000),
  actual_cost: 50_000 + Math.floor(r() * 700_000),
  revised: 120_000 + Math.floor(r() * 950_000),
  projected_cost: 130_000 + Math.floor(r() * 900_000),
  forecast_final_cost: 140_000 + Math.floor(r() * 900_000),
  forecast_variance: Math.floor(r() * 80_000) - 40_000,
  created_at: iso(200), updated_at: iso(Math.floor(r() * 120)),
})));
add("cost_contracts.csv", many(40, (i) => ({
  id: `con-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  code: `C-${200 + i}`, name: `Contract ${200 + i}`, company_id: pick(companies).id,
  type: pick(["Subcontract", "PO"]), status: pick(["draft", "sent", "executed", "closed"]),
  awarded: 200_000 + Math.floor(r() * 2_000_000),
  original_budget: 220_000 + Math.floor(r() * 2_100_000),
  actual_cost: 100_000 + Math.floor(r() * 1_500_000),
  created_at: iso(1 + Math.floor(r() * 160)), updated_at: iso(Math.floor(r() * 40)),
})));
add("cost_change_orders.csv", many(60, (i) => ({
  id: `co-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  number: `CO-${100 + i}`, name: `Change order ${100 + i}`,
  contract_id: `con-${i % 40}`, budget_status: pick(["draft", "pending", "approved", "rejected"]),
  cost_status: pick(["draft", "approved"]),
  approved: Math.floor(r() * 250_000), submitted: Math.floor(r() * 280_000),
  estimated: Math.floor(r() * 300_000),
  created_at: iso(1 + Math.floor(r() * 150)), updated_at: iso(Math.floor(r() * 30)),
})));

add("estimates_estimation_instances.csv", many(120, (i) => ({
  id: `est-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
  name: `Estimate item ${i}`, unit_of_measure: "EA", quantity: 1 + Math.floor(r() * 80),
  material_cost_total: Math.floor(r() * 60_000), labor_cost_total: Math.floor(r() * 40_000),
  equipment_cost_total: Math.floor(r() * 20_000),
  subcontractor_cost_total: Math.floor(r() * 50_000),
  total_cost: 20_000 + Math.floor(r() * 180_000), markup_total: Math.floor(r() * 12_000),
  package_id: `tp${i % 9}`,
  created_at: iso(1 + Math.floor(r() * 150)), updated_at: iso(Math.floor(r() * 30)),
})));

add("iq_issues_quality_risks.csv", many(140, (i) => ({
  id: `iqq-${i}`, predicted_at: iso(1 + Math.floor(r() * 150)),
  risk: pick(["high", "medium", "low"]), updated_at: iso(Math.floor(r() * 40)),
  bim360_account_id: ACCOUNT, bim360_project_id: P(), user_risk: pick(["high", "low", ""]),
})));
add("iq_issues_safety_risk.csv", many(110, (i) => ({
  id: `iqs-${i}`, updated_at: iso(Math.floor(r() * 40)),
  predicted_at: iso(1 + Math.floor(r() * 150)),
  safety_risk_category: pick(["Fall", "Struck-by", "Electrical", "Housekeeping", "PPE"]),
  bim360_account_id: ACCOUNT, bim360_project_id: P(),
})));

add("activities_docs_activities.csv", many(900, (i) => {
  const created = 1 + Math.floor(r() * 90);
  return {
    activity_id: `act-doc-${i}`, bim360_account_id: ACCOUNT, bim360_project_id: P(),
    activity_verb: pick(["upload", "download", "view", "publish", "delete", "share", "comment"]),
    created_by: U().autodesk_id, created_at: iso(created),
    object_display_name: pick(["L2-STRUCT-PLAN.dwg", "MEP-Model.rvt", "Site-Survey.pdf", "Details.pdf"]),
    object_object_type: pick(["File", "Folder", "Version", "Review"]),
    object_version_number: 1 + Math.floor(r() * 6),
  };
}));
return tables;
}

/** Alias for callers that prefer the fixture-specific name. */
export const createDemoFixtureTables = sampleExtractTables;
