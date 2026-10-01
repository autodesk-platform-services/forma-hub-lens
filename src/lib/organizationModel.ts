/** Values accepted by Autodesk's published CompanyPayload.trade enum. */
export const COMPANY_TRADES = [
  "Architecture", "Communications", "Communications | Data", "Concrete",
  "Concrete | Cast-in-Place", "Concrete | Precast", "Construction Management",
  "Conveying Equipment", "Conveying Equipment | Elevators", "Demolition",
  "Earthwork", "Earthwork | Site Excavation & Grading", "Electrical",
  "Electrical Power Generation", "Electronic Safety & Security", "Equipment",
  "Equipment | Kitchen Appliances", "Exterior Improvements", "Exterior | Fences & Gates",
  "Exterior | Landscaping", "Exterior | Irrigation", "Finishes", "Finishes | Carpeting",
  "Finishes | Ceiling", "Finishes | Drywall", "Finishes | Flooring",
  "Finishes | Painting & Coating", "Finishes | Tile", "Fire Suppression",
  "Furnishings", "Furnishings | Casework & Cabinets", "Furnishings | Countertops",
  "Furnishings | Window Treatments", "General Contractor",
  "HVAC Heating, Ventilating, & Air Conditioning", "Industry-Specific Manufacturing Processing",
  "Integrated Automation", "Masonry", "Material Processing & Handling Equipment",
  "Metals", "Metals | Structural Steel / Framing", "Moisture Protection",
  "Moisture Protection | Roofing", "Moisture Protection | Waterproofing", "Openings",
  "Openings | Doors & Frames", "Openings | Entrances & Storefronts",
  "Openings | Glazing", "Openings | Roof Windows & Skylights", "Openings | Windows",
  "Owner", "Plumbing", "Pollution & Waste Control Equipment",
  "Process Gas & Liquid Handling, Purification, & Storage Equipment",
  "Process Heating, Cooling, & Drying Equipment", "Process Integration",
  "Process Integration | Piping", "Special Construction", "Specialties",
  "Specialties | Signage", "Utilities", "Water & Wastewater Equipment",
  "Waterway & Marine Construction", "Wood & Plastics", "Wood & Plastics | Millwork",
  "Wood & Plastics | Rough Carpentry",
] as const;

export type CompanyEditable = {
  name: string;
  trade: string;
  websiteUrl?: string;
  erpId?: string;
  description?: string;
};

export type CompanyChange = {
  mode: "create" | "update";
  companyId?: string;
  before?: CompanyEditable;
  values: CompanyEditable;
  changedFields: Array<keyof CompanyEditable>;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Build a plan from current hub values. Blank optional edit fields mean leave unchanged. */
export function planCompanyChange(
  mode: "create" | "update",
  raw: Partial<Record<keyof CompanyEditable, unknown>>,
  companies: Array<CompanyEditable & { id: string }>,
  companyId?: string,
): CompanyChange {
  const original = mode === "update" ? companies.find((item) => item.id === companyId) : undefined;
  if (mode === "update" && !original) throw new Error("Company was not found in the current hub directory.");
  const name = trimmed(raw.name);
  const trade = trimmed(raw.trade);
  if (!name || name.length > 255) throw new Error("Company name is required and must be at most 255 characters.");
  if (!COMPANY_TRADES.includes(trade as (typeof COMPANY_TRADES)[number]) && !(original && trade === original.trade)) {
    throw new Error("Choose a trade from the Autodesk company trade list.");
  }
  if (companies.some((item) => item.id !== companyId && item.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error("A company with this name already exists in the current hub directory.");
  }
  const websiteUrl = trimmed(raw.websiteUrl) || original?.websiteUrl || undefined;
  if (websiteUrl && (websiteUrl.length > 255 || !/^https?:\/\/[^\s]+$/i.test(websiteUrl))) {
    throw new Error("Website must be an http(s) URL of at most 255 characters.");
  }
  const erpId = trimmed(raw.erpId) || original?.erpId || undefined;
  const description = trimmed(raw.description) || original?.description || undefined;
  if (erpId && erpId.length > 255) throw new Error("ERP ID must be at most 255 characters.");
  if (description && description.length > 255) throw new Error("Description must be at most 255 characters.");
  const values: CompanyEditable = { name, trade, websiteUrl, erpId, description };
  const fields: Array<keyof CompanyEditable> = ["name", "trade", "websiteUrl", "erpId", "description"];
  const changedFields = mode === "create" ? fields.filter((field) => Boolean(values[field]))
    : fields.filter((field) => (values[field] ?? "") !== (original?.[field] ?? ""));
  if (!changedFields.length) throw new Error("No company fields changed. Edit a value before previewing.");
  return { mode, companyId: original?.id, before: original ? { name: original.name, trade: original.trade,
    websiteUrl: original.websiteUrl, erpId: original.erpId, description: original.description } : undefined,
    values, changedFields };
}

export function companyChangeDetails(change: CompanyChange): string[] {
  return change.changedFields.map((field) => `${field}: ${change.before?.[field] || "—"} → ${change.values[field] || "—"}`);
}

export function companyHasChangedSincePreview(change: CompanyChange, current: CompanyEditable): boolean {
  if (change.mode === "create") return false;
  return change.changedFields.some((field) => (change.before?.[field] ?? "") !== (current[field] ?? ""));
}

export function companyMatchesPlannedValues(change: CompanyChange, current: CompanyEditable): boolean {
  return change.changedFields.every((field) => (change.values[field] ?? "") === (current[field] ?? ""));
}
