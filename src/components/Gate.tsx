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
    <Card title="Sign in to Autodesk">
      <p className="max-w-prose text-xs text-adsk-black">
        The Data Connector and Hub Admin endpoints require a three-legged token — a two-legged
        client-credentials token will not do, because Autodesk scopes the data to the signed-in
        user&apos;s hub permissions. Sign in with an account that holds{" "}
        <strong className="text-adsk-black">Hub Admin</strong> or{" "}
        <strong className="text-adsk-black">Executive Overview</strong> rights on the hub, otherwise
        you will only see projects you are a member of.
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
