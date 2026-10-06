import { NextResponse } from "next/server";
import { allBelongToProject, getTask, setTaskAssignments } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { requireProjectOf } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProjectOf("task", id);
  if (!access.ok) return access.response;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.resourceIds) ? body.resourceIds.map(String) : [];
  if (!(await allBelongToProject("resource", ids, task.projectId))) {
    return NextResponse.json({ error: "Team members must be in this plan." }, { status: 400 });
  }
  await setTaskAssignments(id, ids);
  return NextResponse.json({ ok: true, bundle: await loadProject(task.projectId) });
}
