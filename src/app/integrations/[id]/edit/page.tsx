import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { getManifest } from "@/lib/integrationStore";
import { Card, EmptyState } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { IntegrationEditor } from "../../Editor";

export const dynamic = "force-dynamic";

export default async function EditIntegrationPage({ params }: { params: Promise<{ id: string }> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (session.hubRole !== "hub_admin") return <Card title="Hub Admin required">Only a Hub Admin can edit a hub-wide integration manifest.</Card>;
  const { id } = await params;
  const manifest = id.length <= 100 ? getManifest(id) : null;
  if (!manifest) return <Card><EmptyState title="Manifest not found." /></Card>;
  return <div className="space-y-4"><Link href={`/integrations/${id}`} className="text-xs text-adsk-link">← {manifest.name}</Link><IntegrationEditor manifest={manifest} /></div>;
}
