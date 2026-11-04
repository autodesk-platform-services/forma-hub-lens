"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckboxList } from "./CheckboxList";
import { previewDemoChange, executeDemoChange, isDemoEmail, type DemoPlan, type DemoTask, type DemoWorkspace } from "@/lib/demoSimulation";

const tasks: Array<{ id: DemoTask; name: string }> = [{ id: "add", name: "Add members & access" }, { id: "remove", name: "Remove members" }, { id: "projects", name: "Create projects" }, { id: "archive", name: "Archive projects" }];
const inputClass = "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-sm";

export function DemoActionCenter({ initial, initialTask, initialEmail, productOptions }: { initial: DemoWorkspace; initialTask?: string; initialEmail?: string; productOptions: Array<{ key: string; label: string }> }) {
  const [workspace, setWorkspace] = useState(initial);
  const [task, setTask] = useState<DemoTask>(tasks.some((item) => item.id === initialTask) ? initialTask as DemoTask : "add");
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState(initialEmail && isDemoEmail(initialEmail) ? initialEmail : "");
  const [products, setProducts] = useState<string[]>([]);
  const [plan, setPlan] = useState<DemoPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Array<{ action: string; count: number; skipped: number }>>([]);
  function invalidate() { setPlan(null); setConfirmed(false); setError(""); }
  function changeTask(next: DemoTask) { invalidate(); setTask(next); setInput(next === "remove" && initialEmail && isDemoEmail(initialEmail) ? initialEmail : ""); }
  function preview() { try { setPlan(previewDemoChange(workspace, task, selected, input, products)); setConfirmed(false); setError(""); } catch (cause) { setPlan(null); setError(cause instanceof Error ? cause.message : "Review the sample inputs."); } }
  function execute() {
    if (!plan || !confirmed) return;
    setWorkspace(executeDemoChange(workspace, plan));
    setHistory([{ action: tasks.find((item) => item.id === plan.task)!.name, count: plan.changes.length, skipped: plan.skipped.length }, ...history]);
    invalidate();
  }
  function reset() { setWorkspace(initial); setHistory([]); setSelected([]); setInput(""); setProducts([]); invalidate(); }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-legend text-2xl">Admin action center · Demo</h1><p className="mt-1 text-sm text-adsk-gray">Configure, preview, confirm and simulate a bulk action. Changes stay in this view and reset when you leave.</p></div><button type="button" onClick={reset} className="rounded border border-adsk-lightgray px-3 py-2 text-xs">Reset simulation</button></div>
    <p role="note" className="rounded border border-adsk-gold bg-adsk-yellow/10 p-3 text-sm">No invitations are sent and no Autodesk projects or memberships are changed. Product choices demonstrate the preview; no subscriptions are assigned.</p>
    <div className="flex flex-wrap gap-2" aria-label="Sample bulk workflows">{tasks.map((item) => <button type="button" key={item.id} onClick={() => changeTask(item.id)} aria-pressed={task === item.id} className={`rounded border px-3 py-2 text-xs ${task === item.id ? "border-adsk-gold bg-adsk-yellow" : "border-adsk-lightgray bg-adsk-white"}`}>{item.name}</button>)}<Link href="/recipes" className="px-3 py-2 text-xs text-adsk-link underline">Sample provisioning recipe</Link></div>
    <div className="grid gap-5 rounded border border-adsk-lightgray bg-adsk-white p-5 md:grid-cols-2">
      {task !== "projects" && <CheckboxList label="Sample projects" name="sampleProjects" options={workspace.projects.map((project) => ({ value: project.id, label: `${project.name} · ${project.status}` }))} selected={selected} onSelectionChange={(value) => { setSelected(value); invalidate(); }} maxSelected={50} />}
      {task !== "archive" && <div><label className="text-xs font-medium">{task === "projects" ? "Project names · one per line" : "Fictional emails · one per line"}<textarea value={input} onChange={(event) => { setInput(event.target.value); invalidate(); }} rows={7} maxLength={15000} placeholder={task === "projects" ? "Northwind Community Clinic\nNorthwind Logistics Center" : "alex@northwind.example"} className={inputClass} /></label>
        {task === "remove" && <div className="mt-2 text-xs text-adsk-gray"><p className="font-medium">Try a sample person:</p>{workspace.members.slice(0, 5).map((member) => <button key={member.email} type="button" className="mr-3 mt-1 text-adsk-link underline" onClick={() => { setInput(member.email); setSelected(member.projectIds); invalidate(); }}>{member.name}</button>)}</div>}
        {task === "add" && <div className="mt-3"><CheckboxList label="Choose sample product access" name="sampleProducts" options={productOptions.map((product) => ({ value: product.key, label: product.label }))} selected={products} onSelectionChange={(value) => { setProducts(value); invalidate(); }} emptyMessage="No sample products." className="max-h-40" /></div>}
      </div>}
      {task === "archive" && <div className="text-sm text-adsk-gray">Only active sample projects are included in the preview. Archived projects are skipped. The results shown below belong to this simulation.</div>}
      <div className="md:col-span-2"><button type="button" onClick={preview} className="rounded border border-adsk-gold bg-adsk-yellow px-4 py-2 text-sm">Preview simulation</button>{error && <p role="alert" className="mt-2 text-sm text-adsk-linkvisited">{error}</p>}</div>
    </div>
    {plan && <section aria-label="Simulation preview" className="rounded border border-adsk-gold bg-adsk-white p-5"><h2 className="font-semibold">Preview · {plan.changes.length} sample changes · {plan.skipped.length} skipped</h2>{plan.task === "add" && plan.products.length > 0 && <p className="mt-2 text-xs">Product access requested: {plan.products.map((key) => productOptions.find((option) => option.key === key)?.label ?? key).join(", ")}</p>}<ul className="mt-3 max-h-64 overflow-auto text-sm">{plan.changes.map((change, index) => <li className="border-b border-adsk-offwhite py-2" key={index}>{change.label}</li>)}</ul>{plan.skipped.length > 0 && <details className="mt-3 text-xs"><summary>Skipped sample operations</summary><ul>{plan.skipped.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}<label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 accent-adsk-yellow" />I reviewed these fictional changes and want to run the simulation.</label><button type="button" onClick={execute} disabled={!confirmed} className="mt-3 rounded bg-adsk-yellow px-4 py-2 text-sm disabled:opacity-40">Run simulation</button></section>}
    <section id="simulation-history" aria-label="Simulation results" className="scroll-mt-8 rounded border border-adsk-lightgray bg-adsk-white p-5"><h2 className="font-semibold">Simulated results</h2><p className="mt-1 text-xs text-adsk-gray">Verified against this view’s in-memory sample workspace. No server audit or live hub record was created.</p>{history.length ? <ul className="mt-3 space-y-2 text-sm">{history.map((entry, index) => <li key={index}>{entry.action}: {entry.count} simulated · {entry.skipped} skipped</li>)}</ul> : <p className="mt-3 text-sm text-adsk-gray">Run a simulation to see its results here.</p>}<p className="mt-3 text-xs">Sample projects: {workspace.projects.length} · Active: {workspace.projects.filter((project) => project.status === "active").length}</p></section>
  </div>;
}
