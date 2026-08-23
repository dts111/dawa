import { NextResponse } from "next/server";
import { getTask, setTaskAssignments } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.resourceIds) ? body.resourceIds.map(String) : [];
  setTaskAssignments(id, ids);
  return NextResponse.json({ ok: true, bundle: loadProject(task.projectId) });
}
