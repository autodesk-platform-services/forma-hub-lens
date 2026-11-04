export default function DemoWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">
    <p role="note" className="rounded border border-adsk-gold bg-adsk-yellow/10 px-4 py-3 text-xs text-adsk-black">These are fictional integration contracts and migration examples. The demo does not refresh Autodesk schema documentation, monitor customer pipelines, or save integration settings.</p>
    {children}
  </div>;
}
