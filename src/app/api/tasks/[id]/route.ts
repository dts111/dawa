import { NextResponse } from "next/server";
import {
  deleteTask,
  deriveStatus,
  getTask,
  listTasks,
  logActivity,
  percentForStatus,
  updateTask,
} from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { TASK_STATUSES, type Task, type TaskStatus } from "@/lib/types";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(TASK_STATUSES.map((s) => s.key as string));

type Ctx = { params: Promise<{ id: string }> };

/** True when `candidateParentId` sits underneath `taskId` — which would orphan the tree. */
function wouldCreateCycle(tasks: Task[], taskId: string, candidateParentId: string | null): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur = candidateParentId;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur === taskId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = getTask(id);
  if (!existing) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Partial<Task> = {};

  if (typeof body.name === "string") patch.name = body.name.trim() || existing.name;
  if (body.duration !== undefined) patch.duration = Math.max(0, Math.round(Number(body.duration) || 0));
  if (body.percentComplete !== undefined) {
    const pct = Math.min(100, Math.max(0, Math.round(Number(body.percentComplete) || 0)));
    patch.percentComplete = pct;
    // Keep the board column in step with the number typed in the grid.
    patch.status = deriveStatus(pct, existing.status);
  }

  // Dragging a card between board columns moves both status and progress.
  if (body.status && VALID_STATUSES.has(body.status)) {
    const status = body.status as TaskStatus;
    patch.status = status;
    patch.percentComplete = percentForStatus(status, existing.percentComplete);
  }
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.objectives !== undefined) patch.objectives = body.objectives || null;
  if (body.guidance !== undefined) patch.guidance = body.guidance || null;
  if (body.remarks !== undefined) patch.remarks = body.remarks || null;
  if (body.risk !== undefined) {
    const validRisks = new Set(["low", "medium", "high"]);
    patch.risk = typeof body.risk === "string" && validRisks.has(body.risk) ? (body.risk as Task["risk"]) : null;
  }
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);

  // Dragging a bar in the Gantt pins the task with a "start no earlier than".
  if (body.startDate) {
    patch.constraintType = "SNET";
    patch.constraintDate = String(body.startDate);
  }
  if (body.constraintType) patch.constraintType = body.constraintType;
  if (body.constraintDate !== undefined) patch.constraintDate = body.constraintDate;
  if (body.clearConstraint) {
    patch.constraintType = "ASAP";
    patch.constraintDate = null;
  }

  if (body.parentId !== undefined) {
    const tasks = listTasks(existing.projectId);
    if (wouldCreateCycle(tasks, id, body.parentId)) {
      return NextResponse.json({ error: "That move would nest a task inside itself." }, { status: 400 });
    }
    patch.parentId = body.parentId;
  }

  const task = updateTask(id, patch);
  return NextResponse.json({ task, bundle: loadProject(existing.projectId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = getTask(id);
  if (!existing) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  deleteTask(id);
  logActivity({
    projectId: existing.projectId,
    actor: "app",
    message: `Task "${existing.name}" deleted`,
  });
  return NextResponse.json({ ok: true, bundle: loadProject(existing.projectId) });
}
