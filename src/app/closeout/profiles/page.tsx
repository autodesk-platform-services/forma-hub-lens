import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { CLOSEOUT_DOMAINS, listCloseoutProfiles, listExpectedDeliverables } from "@/lib/closeoutStore";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { Card } from "@/components/ui";
import { CheckboxGroup } from "@/components/CheckboxGroup";
import { addDeliverableAction, createProfileAction } from "../actions";
import { RuleEditor } from "./RuleEditor";
import { DeliverableEditor } from "../DeliverableEditor";

export const dynamic = "force-dynamic";
export default async function CloseoutProfilesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const profiles = listCloseoutProfiles();
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const error = typeof params.error === "string" ? params.error : null;
  const admin = session.hubRole === "hub_admin";
  return <div className="space-y-6">
    <div><Link href="/closeout" className="text-xs text-adsk-link">← Closeout portfolio</Link>
      <h1 className="mt-2 font-legend text-2xl">Turnover profiles</h1>
      <p className="mt-1 text-sm text-adsk-gray">Profiles define required evidence domains, asset metadata, and exact deliverable IDs. Assignment history is preserved per project.</p></div>
    {notice && <p role="status" className="rounded bg-green-50 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm">{error}</p>}
    {admin && <Card title="Create profile"><form action={createProfileAction} className="grid gap-3 text-sm sm:grid-cols-2">
      <label>Profile name<input required maxLength={120} name="name" className="mt-1 block w-full rounded border p-2" placeholder="Client turnover standard" /></label>
      <label>Client<input maxLength={120} name="client" className="mt-1 block w-full rounded border p-2" /></label>
      <label>Business unit<input maxLength={120} name="businessUnit" className="mt-1 block w-full rounded border p-2" /></label>
      <label>Project type<input maxLength={120} name="projectType" className="mt-1 block w-full rounded border p-2" /></label>
      <label>Region<input maxLength={120} name="region" className="mt-1 block w-full rounded border p-2" placeholder="US" /></label>
      <label>Delivery model<input maxLength={120} name="deliveryModel" className="mt-1 block w-full rounded border p-2" placeholder="Design build" /></label>
      <fieldset className="sm:col-span-2"><legend className="font-medium">Required evidence domains</legend><CheckboxGroup name="requiredDomains" selectAllLabel="Select all evidence domains"><div className="mt-2 flex flex-wrap gap-3">
        {CLOSEOUT_DOMAINS.map((domain) => <label key={domain} className="flex items-center gap-1 capitalize"><input type="checkbox" name="requiredDomains" value={domain} />{domain}</label>)}
      </div></CheckboxGroup></fieldset>
      <label className="sm:col-span-2">Required field names for every asset<input name="requiredAssetFields" className="mt-1 block w-full rounded border p-2" placeholder="barcode, category_id" /><span className="text-xs text-adsk-gray">Comma separated source column names. Blank means no asset field rule.</span></label>
      <button className="w-fit rounded bg-adsk-black px-4 py-2 text-white">Create profile</button>
    </form></Card>}
    <div className="space-y-4">{profiles.map((profile) => {
      const deliverables = listExpectedDeliverables(profile.id);
      return <Card key={profile.id} title={profile.name}>
        <p className="text-sm text-adsk-gray">{[profile.client, profile.businessUnit, profile.projectType, profile.region, profile.deliveryModel].filter(Boolean).join(" · ") || "General profile"}</p>
        <p className="mt-2 text-sm"><strong>Evidence:</strong> {profile.requiredDomains.join(", ")}. <strong>Asset fields:</strong> {profile.requiredAssetFields.join(", ") || "none"}.</p>
        {admin && <RuleEditor profile={profile} />}
        <h3 className="mt-4 font-medium">Expected deliverables ({deliverables.length})</h3>
        {deliverables.length ? <ul className="mt-2 space-y-1 text-sm">{deliverables.map((item) => <li key={item.id} className="border-b border-adsk-lightgray/70 pb-1">
          <strong>{item.label}</strong> · {item.domain} · exact ID <code>{item.externalId || "unassigned"}</code> · name pattern {item.namePattern || "—"} · folder {item.folderPath || "—"} · required fields {item.requiredMetadata.join(", ") || "none"}
          {admin && <DeliverableEditor item={item} />}
        </li>)}</ul> : <p className="text-xs text-adsk-gray">No exact deliverables registered. Assessments stay Unknown until at least one is added.</p>}
        {admin && <form action={addDeliverableAction} className="mt-4 grid gap-2 border-t border-adsk-lightgray pt-4 text-sm sm:grid-cols-2">
          <input type="hidden" name="profileId" value={profile.id} />
          <label>Deliverable label<input required name="label" maxLength={160} className="mt-1 block w-full rounded border p-2" /></label>
          <label>Evidence domain<select name="domain" className="mt-1 block w-full rounded border p-2">{profile.requiredDomains.map((domain) => <option key={domain}>{domain}</option>)}</select></label>
          <label>Exact source record ID, if known<input name="externalId" maxLength={200} className="mt-1 block w-full rounded border p-2" /></label>
          <label>Expected name pattern<input name="namePattern" maxLength={160} className="mt-1 block w-full rounded border p-2" placeholder="^As Built.*\\.pdf$" /></label>
          <label>Exact folder path<input name="folderPath" maxLength={300} className="mt-1 block w-full rounded border p-2" /></label>
          <label>Required metadata fields<input name="requiredMetadata" className="mt-1 block w-full rounded border p-2" placeholder="barcode, category_id" /></label>
          <button className="w-fit rounded bg-adsk-black px-4 py-2 text-white">Add expected deliverable</button>
        </form>}
      </Card>;
    })}</div>
    {profiles.length === 0 && <p className="text-sm text-adsk-gray">No turnover profiles yet.</p>}
  </div>;
}
