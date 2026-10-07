// Loads everything the UI needs for one project in a single call, with the
// schedule already computed server-side.

import { loadProjectRows } from "./db";
import { scheduleProject } from "./schedule";
import type { ProjectBundleData } from "./types";

export type ProjectBundle = ProjectBundleData;

export async function loadProject(projectId: string): Promise<ProjectBundle | null> {
  // One database round trip for the whole plan.
  const rows = await loadProjectRows(projectId);
  if (!rows) return null;
  const { project, tasks, dependencies, resources, assignments, shareLinks, automations } = rows;
  return {
    project,
    dependencies,
    resources,
    assignments,
    schedule: scheduleProject(project, tasks, dependencies, resources, assignments),
    shareLinks,
    automations,
  };
}
