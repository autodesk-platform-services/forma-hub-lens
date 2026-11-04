/** Pure in-memory simulation. This module has no network, filesystem or database access. */
export type DemoProject = { id: string; name: string; status: string };
export type DemoMember = { email: string; name: string; projectIds: string[] };
export type DemoTask = "add" | "remove" | "projects" | "archive";
export type DemoChange = { projectId: string; label: string; email?: string; name?: string };
export type DemoPlan = { task: DemoTask; changes: DemoChange[]; skipped: string[]; products: string[] };
export type DemoWorkspace = { projects: DemoProject[]; members: DemoMember[] };

export function isDemoEmail(email: string): boolean {
  return /^[^\s@]+@(?:[^\s@]+\.example|example\.(?:com|net|org))$/.test(email);
}

export function previewDemoChange(workspace: DemoWorkspace, task: DemoTask, projectIds: string[], input: string, products: string[] = []): DemoPlan {
  const selected = [...new Set(projectIds)];
  const plan: DemoPlan = { task, changes: [], skipped: [], products: [...new Set(products)] };
  if (task === "projects") {
    const names = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!names.length || names.length > 50) throw new Error("Enter between 1 and 50 project names, one per line.");
    const seen = new Set(workspace.projects.map((project) => project.name.toLowerCase()));
    for (const [index, name] of names.entries()) {
      if (name.length > 255) throw new Error("Project names must be 255 characters or fewer.");
      if (seen.has(name.toLowerCase())) { plan.skipped.push(`${name}: name already exists`); continue; }
      seen.add(name.toLowerCase());
      plan.changes.push({ projectId: `simulated-${workspace.projects.length}-${index}`, name, label: `Create ${name}` });
    }
  } else {
    if (!selected.length || selected.length > 50) throw new Error("Select between 1 and 50 sample projects.");
    const projects = selected.map((id) => {
      const project = workspace.projects.find((item) => item.id === id);
      if (!project) throw new Error("Choose a project from the sample workspace.");
      return project;
    });
    if (task === "archive") {
      for (const project of projects) {
        if (project.status !== "active") plan.skipped.push(`${project.name}: already ${project.status}`);
        else plan.changes.push({ projectId: project.id, label: `Archive ${project.name}` });
      }
    } else {
      const emails = [...new Set(input.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean))];
      if (!emails.length || emails.length > 50) throw new Error("Enter between 1 and 50 email addresses, one per line.");
      // Keep demo identities fictional, including manually entered values.
      if (emails.some((email) => !isDemoEmail(email))) throw new Error("Use fictional addresses at example.com or ending in .example, such as alex@northwind.example.");
      for (const project of projects) for (const email of emails) {
        const exists = workspace.members.some((member) =>
          member.email.trim().toLowerCase() === email && member.projectIds.includes(project.id));
        if ((task === "add" && exists) || (task === "remove" && !exists)) {
          plan.skipped.push(`${email} · ${project.name}: ${exists ? "already a member" : "not a member"}`);
        } else plan.changes.push({ projectId: project.id, email, label: `${task === "add" ? "Add" : "Remove"} ${email} · ${project.name}` });
      }
    }
  }
  if (!plan.changes.length) throw new Error("No changes remain after checking the sample data.");
  return plan;
}

export function executeDemoChange(workspace: DemoWorkspace, plan: DemoPlan): DemoWorkspace {
  const next = { projects: workspace.projects.map((project) => ({ ...project })), members: workspace.members.map((member) => ({ ...member, projectIds: [...member.projectIds] })) };
  for (const change of plan.changes) {
    if (plan.task === "projects") next.projects.push({ id: change.projectId, name: change.name!, status: "active" });
    else if (plan.task === "archive") { const project = next.projects.find((item) => item.id === change.projectId); if (project) project.status = "archived"; }
    else if (change.email) {
      let member = next.members.find((item) => item.email.trim().toLowerCase() === change.email);
      if (!member && plan.task === "add") { member = { email: change.email, name: change.email.split("@")[0], projectIds: [] }; next.members.push(member); }
      if (member) member.projectIds = plan.task === "add" ? [...new Set([...member.projectIds, change.projectId])] : member.projectIds.filter((id) => id !== change.projectId);
    }
  }
  return next;
}
