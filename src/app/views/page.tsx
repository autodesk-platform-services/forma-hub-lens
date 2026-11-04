import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { normalizeSavedPath, savedViewsOwner } from "@/lib/savedViews";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { DemoSavedItems } from "@/components/DemoPreferences";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
export default async function ViewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const params = await searchParams;
  let pathToSave: string | null = null;
  if (typeof params.save === "string") {
    try { pathToSave = normalizeSavedPath(params.save); } catch { /* unsupported save URL */ }
  }
  return <div className="space-y-5">
    <h1 className="font-legend text-2xl text-adsk-black">My saved items · Demo</h1>
    <DemoSavedItems owner={savedViewsOwner(session)} pathToSave={pathToSave} />
  </div>;
}
