export default function DemoWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">
    <p role="note" className="rounded border border-adsk-gold bg-adsk-yellow/10 px-4 py-3 text-xs text-adsk-black">These turnover profiles, files, assets, and workflow records are fictional examples. Project assessments are simulated; real document downloads, handover packaging, acceptance, and Autodesk changes are disabled.</p>
    {children}
  </div>;
}
