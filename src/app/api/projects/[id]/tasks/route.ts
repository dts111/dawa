import { NextResponse } from "next/server";
import { createTask, listTasks, logActivity } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ tasks: listTasks(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "New task").trim() || "New task";

  // Insert directly beneath a given row when the UI asks for it.
  let sortOrder: number | undefined = body.sortOrder;
  if (sortOrder === undefined && body.afterTaskId) {
    const tasks = listTasks(id).sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = tasks.findIndex((t) => t.id === body.afterTaskId);
    if (idx >= 0) {
      const before = tasks[idx].sortOrder;
      const after = tasks[idx + 1]?.sortOrder ?? before + 20;
      sortOrder = (before + after) / 2;
    }
  }

  // Or directly above a given row — scoped to true siblings, so it slots in
  // regardless of what else exists elsewhere in the project.
  if (sortOrder === undefined && body.beforeTaskId) {
    const tasks = listTasks(id);
    const target = tasks.find((t) => t.id === body.beforeTaskId);
    if (target) {
      const siblings = tasks.filter((t) => t.parentId === target.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
      const idx = siblings.findIndex((t) => t.id === target.id);
      const prev = siblings[idx - 1];
      sortOrder = prev ? (prev.sortOrder + target.sortOrder) / 2 : target.sortOrder - 10;
    }
  }

  const task = createTask({
    projectId: id,
    name,
    parentId: body.parentId ?? null,
    sortOrder,
    duration: body.duration ?? 1,
    percentComplete: body.percentComplete ?? 0,
    notes: body.notes ?? null,
  });
  logActivity({ projectId: id, taskId: task.id, actor: "app", message: `Task "${task.name}" added` });
  return NextResponse.json({ task, bundle: loadProject(id) }, { status: 201 });
}
