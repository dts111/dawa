// The scheduling engine: forward pass, backward pass, critical path,
// summary rollup and baseline variance. Pure functions only, so it can be
// unit-tested and reused by the Excel exporter and the email digest.

import { WorkCalendar } from "./calendar";
import type {
  Assignment,
  Dependency,
  Project,
  Resource,
  ScheduleResult,
  ScheduledTask,
  Task,
  TaskStatus,
} from "./types";

/** Status is stored per task; summaries take theirs from their children. */
function leafStatus(t: Task): TaskStatus {
  const pct = Math.min(100, Math.max(0, Math.round(t.percentComplete)));
  if (pct >= 100) return "done";
  if (t.status === "blocked") return "blocked";
  if (t.status === "in_progress" || pct > 0) return "in_progress";
  return "not_started";
}

function rollUpStatus(children: TaskStatus[]): TaskStatus {
  if (children.some((s) => s === "blocked")) return "blocked";
  if (children.every((s) => s === "done")) return "done";
  if (children.every((s) => s === "not_started")) return "not_started";
  return "in_progress";
}

/** Signed difference in working days: positive when `b` is later than `a`. */
function signedWorkingDiff(cal: WorkCalendar, a: string, b: string): number {
  const n = cal.workingDaysBetween(a, b);
  return n >= 0 ? n - 1 : n + 1;
}

interface TreeNode {
  task: Task;
  children: TreeNode[];
  wbs: string;
  level: number;
}

function buildTree(tasks: Task[]): TreeNode[] {
  const byParent = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    // An orphaned parentId is treated as a root so nothing silently disappears.
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }

  const seen = new Set<string>();
  const walk = (parentId: string | null, prefix: string, level: number): TreeNode[] => {
    const kids = byParent.get(parentId) ?? [];
    return kids.flatMap((task, i) => {
      if (seen.has(task.id)) return []; // guards against a parent cycle
      seen.add(task.id);
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      return [{ task, wbs, level, children: walk(task.id, wbs, level + 1) }];
    });
  };
  return walk(null, "", 0);
}

/** Depth-first flatten, which is the order rows appear in the grid. */
function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function leafIdsOf(node: TreeNode): string[] {
  if (!node.children.length) return [node.task.id];
  return node.children.flatMap(leafIdsOf);
}

export function scheduleProject(
  project: Project,
  tasks: Task[],
  dependencies: Dependency[],
  resources: Resource[] = [],
  assignments: Assignment[] = [],
): ScheduleResult {
  const cal = new WorkCalendar(project.workingDays, project.holidays);
  const errors: string[] = [];
  const projectStart = cal.nextWorkingDay(project.startDate);

  const roots = buildTree(tasks);
  const ordered = flatten(roots);
  const nodeById = new Map(ordered.map((n) => [n.task.id, n]));
  const leafSet = new Set(ordered.filter((n) => !n.children.length).map((n) => n.task.id));

  // --- Expand any dependency touching a summary row down to its leaves. -----
  // Linking summary tasks is discouraged in MS Project; rather than reject it we
  // translate it into the equivalent set of leaf-level links.
  const links: Dependency[] = [];
  for (const dep of dependencies) {
    const pred = nodeById.get(dep.predecessorId);
    const succ = nodeById.get(dep.successorId);
    if (!pred || !succ) {
      errors.push(`Link ignored: one end no longer exists.`);
      continue;
    }
    const predLeaves = leafIdsOf(pred);
    const succLeaves = leafIdsOf(succ);
    for (const p of predLeaves) {
      for (const s of succLeaves) {
        if (p === s) continue;
        links.push({ ...dep, predecessorId: p, successorId: s });
      }
    }
  }

  const successorsOf = new Map<string, Dependency[]>();
  const predecessorsOf = new Map<string, Dependency[]>();
  for (const l of links) {
    if (!successorsOf.has(l.predecessorId)) successorsOf.set(l.predecessorId, []);
    successorsOf.get(l.predecessorId)!.push(l);
    if (!predecessorsOf.has(l.successorId)) predecessorsOf.set(l.successorId, []);
    predecessorsOf.get(l.successorId)!.push(l);
  }

  // --- Topological order over leaf tasks. -----------------------------------
  const indegree = new Map<string, number>();
  for (const id of leafSet) indegree.set(id, 0);
  for (const l of links) {
    if (leafSet.has(l.successorId)) indegree.set(l.successorId, (indegree.get(l.successorId) ?? 0) + 1);
  }
  const queue = [...leafSet].filter((id) => (indegree.get(id) ?? 0) === 0);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const l of successorsOf.get(id) ?? []) {
      const d = (indegree.get(l.successorId) ?? 0) - 1;
      indegree.set(l.successorId, d);
      if (d === 0) queue.push(l.successorId);
    }
  }
  if (topo.length < leafSet.size) {
    const stuck = [...leafSet].filter((id) => !topo.includes(id));
    errors.push(
      `Circular dependency detected involving: ${stuck
        .map((id) => nodeById.get(id)?.task.name ?? id)
        .join(", ")}. Those tasks were scheduled from the project start instead.`,
    );
    topo.push(...stuck);
  }

  // --- Forward pass. --------------------------------------------------------
  const start = new Map<string, string>();
  const finish = new Map<string, string>();

  for (const id of topo) {
    const task = nodeById.get(id)!.task;
    const dur = Math.max(0, Math.round(task.duration));
    let es = projectStart;

    for (const l of predecessorsOf.get(id) ?? []) {
      const ps = start.get(l.predecessorId);
      const pf = finish.get(l.predecessorId);
      if (!ps || !pf) continue; // predecessor is inside a cycle
      let candidate: string;
      switch (l.type) {
        case "SS":
          candidate = cal.addWorkingDays(ps, l.lag);
          break;
        case "FF":
          candidate = cal.startFor(cal.addWorkingDays(pf, l.lag), dur);
          break;
        case "SF":
          candidate = cal.startFor(cal.addWorkingDays(ps, l.lag), dur);
          break;
        case "FS":
        default:
          candidate = cal.addWorkingDays(pf, 1 + l.lag);
          break;
      }
      if (cal.workingDaysBetween(es, candidate) > 0) es = candidate;
    }

    if (task.constraintType === "MSO" && task.constraintDate) {
      es = cal.nextWorkingDay(task.constraintDate);
    } else if (task.constraintType === "SNET" && task.constraintDate) {
      const c = cal.nextWorkingDay(task.constraintDate);
      if (cal.workingDaysBetween(es, c) > 0) es = c;
    }

    es = cal.nextWorkingDay(es);
    start.set(id, es);
    finish.set(id, cal.finishFor(es, dur));
  }

  const projectFinish =
    topo.length > 0
      ? topo
          .map((id) => finish.get(id)!)
          .reduce((a, b) => (cal.workingDaysBetween(a, b) > 0 ? b : a))
      : projectStart;

  // --- Backward pass. -------------------------------------------------------
  const lateFinish = new Map<string, string>();
  const lateStart = new Map<string, string>();

  for (const id of [...topo].reverse()) {
    const dur = Math.max(0, Math.round(nodeById.get(id)!.task.duration));
    let lf = projectFinish;
    for (const l of successorsOf.get(id) ?? []) {
      const sLS = lateStart.get(l.successorId);
      const sLF = lateFinish.get(l.successorId);
      if (!sLS || !sLF) continue;
      const sDur = Math.max(0, Math.round(nodeById.get(l.successorId)!.task.duration));
      let candidate: string;
      switch (l.type) {
        case "SS":
          candidate = cal.finishFor(cal.addWorkingDays(sLS, -l.lag), dur);
          break;
        case "FF":
          candidate = cal.addWorkingDays(sLF, -l.lag);
          break;
        case "SF":
          candidate = cal.finishFor(cal.addWorkingDays(sLF, -l.lag), dur);
          break;
        case "FS":
        default:
          candidate = cal.addWorkingDays(sLS, -(1 + l.lag));
          break;
      }
      void sDur;
      if (cal.workingDaysBetween(candidate, lf) > 0) lf = candidate;
    }
    lateFinish.set(id, lf);
    lateStart.set(id, cal.startFor(lf, dur));
  }

  // --- Resource lookup for cost + names. ------------------------------------
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const assignmentsByTask = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!assignmentsByTask.has(a.taskId)) assignmentsByTask.set(a.taskId, []);
    assignmentsByTask.get(a.taskId)!.push(a);
  }

  // --- Assemble results, rolling summaries up from their children. ----------
  const result = new Map<string, ScheduledTask>();

  const build = (node: TreeNode): ScheduledTask => {
    const t = node.task;
    const isSummary = node.children.length > 0;
    const kids = node.children.map(build);

    let s: string;
    let f: string;
    let ls: string;
    let lf: string;
    let pct: number;
    let cost: number;
    let duration: number;

    if (isSummary) {
      s = kids.map((k) => k.start).reduce((a, b) => (cal.workingDaysBetween(a, b) < 0 ? b : a));
      f = kids.map((k) => k.finish).reduce((a, b) => (cal.workingDaysBetween(a, b) > 0 ? b : a));
      ls = kids.map((k) => k.lateStart).reduce((a, b) => (cal.workingDaysBetween(a, b) < 0 ? b : a));
      lf = kids.map((k) => k.lateFinish).reduce((a, b) => (cal.workingDaysBetween(a, b) > 0 ? b : a));
      duration = cal.workingDaysBetween(s, f);
      const weight = kids.reduce((acc, k) => acc + Math.max(1, k.duration), 0);
      pct =
        weight > 0
          ? Math.round(
              kids.reduce((acc, k) => acc + k.rolledPercentComplete * Math.max(1, k.duration), 0) / weight,
            )
          : 0;
      cost = kids.reduce((acc, k) => acc + k.cost, 0);
    } else {
      s = start.get(t.id) ?? projectStart;
      f = finish.get(t.id) ?? s;
      ls = lateStart.get(t.id) ?? s;
      lf = lateFinish.get(t.id) ?? f;
      duration = Math.max(0, Math.round(t.duration));
      pct = Math.min(100, Math.max(0, Math.round(t.percentComplete)));
      const rate = (assignmentsByTask.get(t.id) ?? []).reduce((acc, a) => {
        const r = resourceById.get(a.resourceId);
        return acc + (r ? r.dayRate * (a.units / 100) : 0);
      }, 0);
      cost = rate * Math.max(duration, 0);
    }

    const totalFloat = signedWorkingDiff(cal, f, lf);
    const mine = assignmentsByTask.get(t.id) ?? [];
    const names = mine
      .map((a) => resourceById.get(a.resourceId)?.name)
      .filter((n): n is string => Boolean(n));
    const resourceIds = mine.filter((a) => resourceById.has(a.resourceId)).map((a) => a.resourceId);
    const effectiveStatus = isSummary ? rollUpStatus(kids.map((k) => k.effectiveStatus)) : leafStatus(t);

    const scheduled: ScheduledTask = {
      ...t,
      duration,
      wbs: node.wbs,
      level: node.level,
      isSummary,
      isMilestone: !isSummary && Math.round(t.duration) === 0,
      start: s,
      finish: f,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      isCritical: !isSummary && totalFloat <= 0,
      rolledPercentComplete: pct,
      finishVariance: t.baselineFinish ? signedWorkingDiff(cal, t.baselineFinish, f) : null,
      startVariance: t.baselineStart ? signedWorkingDiff(cal, t.baselineStart, s) : null,
      cost,
      resourceNames: names,
      resourceIds,
      effectiveStatus,
    };
    result.set(t.id, scheduled);
    return scheduled;
  };

  roots.forEach(build);

  const tasksOut = ordered.map((n) => result.get(n.task.id)!).filter(Boolean);

  return {
    tasks: tasksOut,
    projectStart,
    projectFinish,
    totalDuration: cal.workingDaysBetween(projectStart, projectFinish),
    criticalPath: tasksOut.filter((t) => t.isCritical).map((t) => t.id),
    errors,
  };
}

/** Predecessor labels in MS Project style, e.g. "3FS+2d". */
export function predecessorLabel(
  taskId: string,
  dependencies: Dependency[],
  tasks: ScheduledTask[],
): string {
  const wbsById = new Map(tasks.map((t) => [t.id, t.wbs]));
  return dependencies
    .filter((d) => d.successorId === taskId)
    .map((d) => {
      const w = wbsById.get(d.predecessorId) ?? "?";
      const lag = d.lag === 0 ? "" : `${d.lag > 0 ? "+" : ""}${d.lag}d`;
      return `${w}${d.type === "FS" ? "" : d.type}${lag}`;
    })
    .join(", ");
}
