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

export function loadProject(projectId: string): ProjectBundle | null {
  const project = getProject(projectId);
  if (!project) return null;
  const tasks = listTasks(projectId);
  const dependencies = listDependencies(projectId);
  const resources = listResources(projectId);
  const assignments = listAssignments(projectId);
  return {
    project,
    dependencies,
    resources,
    assignments,
    schedule: scheduleProject(project, tasks, dependencies, resources, assignments),
    shareLinks: listShareLinks(projectId),
    automations: listAutomations(projectId),
  };
}
