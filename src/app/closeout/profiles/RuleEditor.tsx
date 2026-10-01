import { CLOSEOUT_DOMAINS, type CloseoutProfile } from "@/lib/closeoutStore";
import { addProfileRuleAction, removeProfileRuleAction } from "../actions";

type ListName = "files" | "assets" | "relationships" | "projectMetadata" | "statusPolicies";
const inputClass = "mt-1 block w-full rounded border p-2";
function ExistingRules({ profile, list, label }: { profile: CloseoutProfile; list: ListName; label: string }) {
  const rules = profile.rules[list];
  return <div className="mt-3"><h4 className="font-medium">{label} ({rules.length})</h4>
    {rules.length ? <ul className="mt-1 space-y-1 text-xs">{rules.map((rule, index) => <li key={index} className="flex flex-wrap items-start justify-between gap-2 rounded border px-2 py-1">
      <code className="max-w-xl break-all">{JSON.stringify(rule)}</code>
      <form action={removeProfileRuleAction}><input type="hidden" name="profileId" value={profile.id} />
        <input type="hidden" name="ruleList" value={list} /><input type="hidden" name="ruleIndex" value={index} />
        <button className="text-red-700 hover:underline" aria-label={`Remove ${label} rule ${index + 1}`}>Remove</button></form>
    </li>)}</ul> : <p className="text-xs text-adsk-gray">None configured.</p>}
  </div>;
}
export function RuleEditor({ profile }: { profile: CloseoutProfile }) {
  return <details className="mt-4 rounded border p-3"><summary className="cursor-pointer font-medium">Turnover requirements and validation rules</summary>
    <p className="mt-2 text-xs text-adsk-gray">Rules are explicit. A domain being present does not make every open record turnover critical. Missing fields or incomplete sources produce Unknown. Rule edits make saved readiness assessments stale.</p>
    <ExistingRules profile={profile} list="files" label="File and folder rules" />
    <form action={addProfileRuleAction} className="mt-2 grid gap-2 border-b pb-4 text-xs sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="ruleList" value="files" />
      <label>Rule label<input required name="label" maxLength={160} className={inputClass} placeholder="Final as-built drawings" /></label>
      <label>Exact folder path<input name="folderPath" maxLength={300} className={inputClass} placeholder="Project Files/Closeout" /></label>
      <label>Allowed extensions<input name="extensions" className={inputClass} placeholder="pdf, dwg" /></label>
      <label>File name pattern<input name="namePattern" maxLength={128} className={inputClass} placeholder="^AsBuilt.*\\.pdf$" /></label>
      <label>Minimum matching files<input type="number" min="1" max="10000" name="minCount" className={inputClass} placeholder="1" /></label>
      <label>Required metadata fields<input name="requiredMetadata" className={inputClass} placeholder="discipline, classification" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" name="includeDescendants" value="yes" /> Include nested folders</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="requireLatestFinalVersion" value="yes" /> Require pinned latest final version</label>
      <button className="w-fit rounded border px-3 py-2">Add file or folder rule</button>
    </form>
    <ExistingRules profile={profile} list="assets" label="Asset validation rules" />
    <form action={addProfileRuleAction} className="mt-2 grid gap-2 border-b pb-4 text-xs sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="ruleList" value="assets" />
      <label>Rule label<input required name="label" maxLength={160} className={inputClass} placeholder="Commissioned pumps" /></label>
      <label>Category<input name="category" maxLength={160} className={inputClass} placeholder="Mechanical" /></label>
      <label>Status<input name="status" maxLength={160} className={inputClass} placeholder="Commissioned" /></label>
      <label>Location<input name="location" maxLength={160} className={inputClass} placeholder="Building A/Level 1" /></label>
      <label>Custom attributes<input name="attributes" className={inputClass} placeholder="Serial=ABC, Warranty=12 months" /></label>
      <label>Minimum matching assets<input type="number" min="1" max="10000" name="minCount" className={inputClass} placeholder="1" /></label>
      <label>Required metadata fields<input name="requiredMetadata" className={inputClass} placeholder="barcode, category" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" name="requireDocumentRelationship" value="yes" /> Require linked Files record</label>
      <button className="w-fit rounded border px-3 py-2">Add asset rule</button>
    </form>
    <ExistingRules profile={profile} list="relationships" label="Relationship rules" />
    <form action={addProfileRuleAction} className="mt-2 grid gap-2 border-b pb-4 text-xs sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="ruleList" value="relationships" />
      <label>Rule label<input required name="label" maxLength={160} className={inputClass} placeholder="Assets linked to documents" /></label>
      <label>From domain<select name="fromDomain" className={inputClass}>{CLOSEOUT_DOMAINS.map((domain) => <option key={domain}>{domain}</option>)}</select></label>
      <label>To domain<select name="toDomain" className={inputClass}>{CLOSEOUT_DOMAINS.map((domain) => <option key={domain}>{domain}</option>)}</select></label>
      <label>Relationship type<input name="relationshipType" maxLength={160} className={inputClass} placeholder="references" /></label>
      <label>Minimum matching relationships<input type="number" min="1" max="10000" name="minCount" className={inputClass} placeholder="1" /></label>
      <button className="w-fit rounded border px-3 py-2">Add relationship rule</button>
    </form>
    <ExistingRules profile={profile} list="projectMetadata" label="Project metadata rules" />
    <form action={addProfileRuleAction} className="mt-2 grid gap-2 border-b pb-4 text-xs sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="ruleList" value="projectMetadata" />
      <label>Source field<input required name="metadataField" className={inputClass} placeholder="region or delivery_model" /></label>
      <label>Label<input name="label" maxLength={160} className={inputClass} placeholder="Region" /></label>
      <label>Expected value, if exact<input name="equals" maxLength={160} className={inputClass} placeholder="US" /></label>
      <button className="w-fit rounded border px-3 py-2">Add metadata rule</button>
    </form>
    <ExistingRules profile={profile} list="statusPolicies" label="Record closure policies" />
    <form action={addProfileRuleAction} className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="ruleList" value="statusPolicies" />
      <label>Domain<select name="domain" className={inputClass}>{["issues", "forms", "submittals", "reviews", "rfis", "transmittals"].map((domain) => <option key={domain}>{domain}</option>)}</select></label>
      <label>Open statuses to block<input required name="openStatuses" className={inputClass} placeholder="open, in review, draft" /></label>
      <label>Terminal statuses to accept<input name="terminalStatuses" className={inputClass} placeholder="closed, approved, void" /></label>
      <button className="w-fit rounded border px-3 py-2">Set closure policy for domain</button>
    </form>
  </details>;
}
