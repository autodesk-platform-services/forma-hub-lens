"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { Company } from "@/lib/aps/hubAdmin";
import { COMPANY_TRADES } from "@/lib/organizationModel";
import type { RoleDirectory } from "@/lib/organization";
import { companyChangeAction } from "@/app/manage/organizationActions";
import type { ManageState } from "@/app/manage/actions";

const input = "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-blue focus:outline-none";
const label = "block font-legend text-[10px] uppercase tracking-wide text-adsk-gray";

function CompanyEditor({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(companyChangeAction, null);
  const mode = company ? "update_company" : "create_company";
  return <div className="mt-4 rounded border border-adsk-lightgray bg-adsk-offwhite p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-legend text-sm text-adsk-black">{company ? `Edit ${company.name ?? company.id}` : "Create partner company"}</h3>
      <button type="button" onClick={onClose} className="text-xs text-adsk-link hover:underline">Close</button>
    </div>
    <p className="mt-1 text-xs text-adsk-gray">Autodesk company directory · signed-in Hub Admin. A stored preview is required before a write.</p>
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="kind" value={mode} />
      {company && <input type="hidden" name="companyId" value={company.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="org-name" className={label}>Company name</label><input id="org-name" name="name" required maxLength={255} defaultValue={company?.name ?? ""} className={input} /></div>
        <div><label htmlFor="org-trade" className={label}>Trade</label><select id="org-trade" name="trade" required defaultValue={company?.trade ?? ""} className={input}>
          <option value="">Choose trade…</option>
          {company?.trade && !COMPANY_TRADES.includes(company.trade as (typeof COMPANY_TRADES)[number]) && <option value={company.trade}>{company.trade} (existing value)</option>}
          {COMPANY_TRADES.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
        </select></div>
        <div><label htmlFor="org-website" className={label}>Website (optional)</label><input id="org-website" name="websiteUrl" type="url" maxLength={255} defaultValue={company?.websiteUrl ?? ""} className={input} placeholder="https://example.com" /></div>
        <div><label htmlFor="org-erp" className={label}>ERP ID (optional)</label><input id="org-erp" name="erpId" maxLength={255} defaultValue={company?.erpId ?? ""} className={input} /></div>
      </div>
      <div><label htmlFor="org-description" className={label}>Description (optional)</label><textarea id="org-description" name="description" maxLength={255} rows={2} className={input} /></div>
      {company && <p className="text-xs text-adsk-gray">Blank optional fields leave their current Autodesk values unchanged. Current description is read during preview.</p>}
      <button type="submit" disabled={pending} className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black disabled:opacity-50">
        {pending ? "Working…" : company ? "Preview company changes" : "Preview company creation"}
      </button>
      {state && <div role={state.ok ? "status" : "alert"} className="space-y-2 text-xs">
        <p className={state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}>{state.message}</p>
        {state.preview && <div className="rounded border border-adsk-gold bg-adsk-gold/10 p-3">
          <p className="font-semibold">Review and confirm this stored preview</p>
          <p className="mt-1 text-adsk-gray">{state.preview.planned} company change · expires {new Date(state.preview.expiresAt).toLocaleTimeString()}. Edits above require a new preview.</p>
          <ul className="mt-2 space-y-0.5">{state.preview.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          <a href={`/manage/preview/${state.preview.id}/export`} className="mt-2 block text-adsk-link hover:underline">Export preview CSV</a>
          <input type="hidden" name="planId" value={state.preview.id} />
          <button type="submit" name="intent" value="execute" disabled={pending} className="mt-2 rounded bg-adsk-black px-3 py-1.5 font-legend text-xs text-adsk-white disabled:opacity-50">Confirm and execute stored preview</button>
        </div>}
        {!state.preview && state.detail?.map((detail) => <p key={detail} className="text-adsk-gray">{detail}</p>)}
        {state.operationId && <Link href={`/manage/audit/${state.operationId}`} className="inline-block text-adsk-link hover:underline">Verify operation in audit →</Link>}
      </div>}
    </form>
  </div>;
}

export function CompaniesPanel({ companies, error }: { companies: Company[]; error: string | null }) {
  const [query, setQuery] = useState("");
  const [trade, setTrade] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<string | null | "create">(null);
  const trades = useMemo(() => [...new Set(companies.map((company) => company.trade).filter((value): value is string => Boolean(value)))].sort(), [companies]);
  const statuses = useMemo(() => [...new Set(companies.map((company) => company.status).filter((value): value is string => Boolean(value)))].sort(), [companies]);
  const filtered = companies.filter((company) => {
    const needle = query.trim().toLowerCase();
    return (!needle || [company.name, company.id, company.erpId].some((value) => value?.toLowerCase().includes(needle)))
      && (!trade || company.trade === trade) && (!status || company.status === status);
  });
  const editingCompany = editor && editor !== "create" ? companies.find((company) => company.id === editor) ?? null : null;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-adsk-gray">Current Forma Admin API company directory. Create and edit use Autodesk&apos;s Account Admin Company API.</p>
      <button type="button" onClick={() => setEditor("create")} className="rounded bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Create company</button>
    </div>
    {error && <p role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 p-3 text-xs">Could not load companies: {error}</p>}
    {!error && <>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>Search name, ID or ERP ID<input value={query} onChange={(event) => setQuery(event.target.value)} className={input} /></label>
        <label className={label}>Trade<select value={trade} onChange={(event) => setTrade(event.target.value)} className={input}><option value="">All trades</option>{trades.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className={label}>Status<select value={status} onChange={(event) => setStatus(event.target.value)} className={input}><option value="">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className="text-xs text-adsk-gray">{filtered.length} of {companies.length} companies</p>
      <div className="max-h-[26rem] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-adsk-white"><tr className="border-b border-adsk-lightgray text-[10px] uppercase tracking-wide text-adsk-gray"><th className="py-2 pr-2">Company</th><th className="py-2 pr-2">Trade</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2 text-right">Projects</th><th className="py-2 pr-2 text-right">Users</th><th className="py-2">Action</th></tr></thead>
        <tbody>{filtered.map((company) => <tr key={company.id} className="border-b border-adsk-offwhite"><td className="py-2 pr-2"><Link href={`/companies/${encodeURIComponent(company.id)}`} className="text-adsk-link hover:underline">{company.name ?? company.id}</Link><span className="block font-mono text-[10px] text-adsk-gray">{company.id}</span></td><td className="py-2 pr-2">{company.trade ?? "—"}</td><td className="py-2 pr-2">{company.status ?? "—"}</td><td className="py-2 pr-2 text-right">{company.projectSize ?? "—"}</td><td className="py-2 pr-2 text-right">{company.userSize ?? "—"}</td><td className="py-2"><button type="button" onClick={() => setEditor(company.id)} className="text-adsk-link hover:underline">Edit</button></td></tr>)}</tbody></table>
        {filtered.length === 0 && <p className="p-3 text-xs text-adsk-gray">No matching companies.</p>}
      </div>
    </>}
    {editor && <CompanyEditor key={editor} company={editingCompany} onClose={() => setEditor(null)} />}
  </div>;
}

export function RolesPanel({ directory }: { directory: RoleDirectory }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const roles = directory.roles.filter((role) => (!query.trim() || `${role.name} ${role.id}`.toLowerCase().includes(query.trim().toLowerCase()))
    && (!status || role.status === status));
  return <div className="space-y-3 text-xs">
    <p className="text-adsk-gray">Role definitions come from {directory.tableName ? <code>{directory.tableName}.csv</code> : "a Data Connector admin extract"}. User associations require <code>admin_project_user_roles.csv</code>. These are local snapshots, not current permissions.</p>
    {directory.uploadedAt && <p className="text-adsk-gray">Imported {new Date(directory.uploadedAt).toLocaleString()}{directory.truncated ? " · truncated" : ""}{directory.trusted ? " · trusted APS job" : " · source unverified"}.</p>}
    {directory.roles.length === 0 ? <p className="rounded border border-adsk-lightgray p-3 text-adsk-gray">No role definitions are available. Ingest or upload a Data Connector extract with the admin service group.</p> : <>
      <div className="flex flex-wrap items-end gap-2"><label className={`${label} min-w-56 flex-1`}>Search role or ID<input value={query} onChange={(event) => setQuery(event.target.value)} className={input} /></label><label className={label}>Status<select value={status} onChange={(event) => setStatus(event.target.value)} className={input}><option value="">All statuses</option>{["active", "inactive", "mixed", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><a href="/manage/roles/export" className="rounded border border-adsk-lightgray px-3 py-1.5 text-adsk-link">Export role inventory CSV</a></div>
      <p className="text-adsk-gray">{roles.length} of {directory.roles.length} roles</p>
      <div className="max-h-[26rem] overflow-auto"><table className="w-full text-left"><thead className="sticky top-0 bg-adsk-white"><tr className="border-b border-adsk-lightgray text-[10px] uppercase tracking-wide text-adsk-gray"><th className="py-2 pr-2">Role</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2 text-right">Projects in snapshot</th><th className="py-2 pr-2 text-right">People in snapshot</th><th className="py-2">Role ID</th></tr></thead><tbody>{roles.map((role) => <tr key={role.id} className="border-b border-adsk-offwhite"><td className="py-2 pr-2"><Link href={`/manage/roles/${encodeURIComponent(role.id)}`} className="text-adsk-link hover:underline">{role.name}</Link></td><td className="py-2 pr-2">{role.status}</td><td className="py-2 pr-2 text-right">{role.projectIds.length}</td><td className="py-2 pr-2 text-right">{role.userCount ?? "Unknown"}</td><td className="py-2 font-mono text-[10px]">{role.id}</td></tr>)}</tbody></table>{roles.length === 0 && <p className="p-3 text-adsk-gray">No matching roles.</p>}</div>
    </>}
  </div>;
}
