import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { Card } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { IntegrationEditor } from "../Editor";

export const dynamic = "force-dynamic";

export default async function NewIntegrationPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (session.hubRole !== "hub_admin") return <Card title="Hub Admin required">Only a Hub Admin can register a hub-wide integration manifest.</Card>;
  return <div className="space-y-4"><Link href="/integrations" className="text-xs text-adsk-link">← Integration Health</Link><IntegrationEditor manifest={null} /></div>;
}
