import { Card } from "./ui";

export function SetupRequired({ problems }: { problems: string[] }) {
  return (
    <Card title="Configuration incomplete">
      <p className="text-xs text-adsk-black">
        Copy <code className="rounded bg-adsk-lightgray px-1">.env.example</code> to{" "}
        <code className="rounded bg-adsk-lightgray px-1">.env.local</code> and fill in the values below,
        then restart <code className="rounded bg-adsk-lightgray px-1">npm run dev</code>.
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
    <Card title="A clearer view of your Forma hub">
      <p className="max-w-2xl text-sm text-adsk-black">
        Forma Hub Lens brings project activity, people and access, data health, and administrative
        workflows into one portfolio view. Start with the review queue, then open the evidence
        behind any project or data signal.
      </p>
      <div className="mt-4 grid gap-3 text-xs text-adsk-gray sm:grid-cols-3">
        <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">See the portfolio</strong>Compare projects, activity, and adoption across the hub.</div>
        <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">Investigate access</strong>Find people, memberships, and folder assignments.</div>
        <div className="rounded border border-adsk-lightgray p-3"><strong className="block text-adsk-black">Act with context</strong>Preview Hub Admin changes and inspect the local audit record.</div>
      </div>
      <p className="mt-4 max-w-2xl text-xs text-adsk-gray">
        Sign in with an Autodesk account that has <strong>Hub Admin</strong> or
        <strong> Executive Overview</strong> access on this hub. Lens verifies that role before
        showing portfolio data. Administrative changes require Hub Admin.
      </p>
      <a
        href="/api/aps/login"
        className="mt-4 inline-block rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90"
      >
        Sign in with Autodesk
      </a>
    </Card>
  );
}
