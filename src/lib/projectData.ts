// Loads everything the UI needs for one project in a single call, with the
// schedule already computed server-side.

import {
  getProject,
  listAssignments,
  listAutomations,
  listDependencies,
  listResources,
  listShareLinks,
  listTasks,
} from "./db";
import { scheduleProject } from "./schedule";
import type { ProjectBundleData } from "./types";

export type ProjectBundle = ProjectBundleData;

export async function loadProject(projectId: string): Promise<ProjectBundle | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const [tasks, dependencies, resources, assignments, shareLinks, automations] = await Promise.all([
    listTasks(projectId),
    listDependencies(projectId),
    listResources(projectId),
    listAssignments(projectId),
    listShareLinks(projectId),
    listAutomations(projectId),
  ]);
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
