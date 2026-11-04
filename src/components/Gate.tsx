import { Card } from "./ui";

export function SetupRequired({ problems }: { problems: string[] }) {
  return (
    <Card title="Configuration incomplete">
      <p className="text-xs text-adsk-black">
        This deployment serves synthetic demo data without sign-in or APS credentials. Correct
        the configuration below, then restart the local server or create a new Vercel deployment.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-adsk-linkvisited">
        {problems.map((problem) => (
          <li key={problem}>• {problem}</li>
        ))}
      </ul>
    </Card>
  );
}

export function SignInRequired() {
    return (
      <Card title="Explore a synthetic Forma hub">
        <p className="max-w-2xl text-sm text-adsk-black">
          Forma Hub Lens brings project activity, people and access, data health, and administrative
          workflows into one portfolio view. This demo uses sample hub records so you can explore
          the review queue and the evidence behind each signal.
        </p>
        <div className="mt-4 grid gap-3 text-xs text-adsk-gray sm:grid-cols-3">
          <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">Explore projects</strong>Review a sample portfolio, activity, and adoption.</div>
          <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">Investigate access</strong>Trace simulated people, memberships, and permissions.</div>
          <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">Preview workflows</strong>See how administrative decisions are prepared and reviewed.</div>
        </div>
        <p className="mt-4 max-w-2xl text-xs text-adsk-gray">
          No account or Autodesk sign-in is required. All data and administrative actions are simulated.
        </p>
        <a
          href="/"
          className="mt-4 inline-block rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90"
        >
          Open demo hub
        </a>
      </Card>
    );
}
