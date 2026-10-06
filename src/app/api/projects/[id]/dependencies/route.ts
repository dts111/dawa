import { NextResponse } from "next/server";
import { allBelongToProject, createDependency, listDependencies } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { scheduleProject } from "@/lib/schedule";
import { listTasks, getProject } from "@/lib/db";
import { requireProject } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  return NextResponse.json({ dependencies: await listDependencies(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const body = await req.json().catch(() => ({}));
  const predecessorId = String(body.predecessorId ?? "");
  const successorId = String(body.successorId ?? "");
  if (!predecessorId || !successorId || predecessorId === successorId) {
    return NextResponse.json({ error: "Pick two different tasks to link." }, { status: 400 });
  }
  if (!(await allBelongToProject("task", [predecessorId, successorId], id))) {
    return NextResponse.json({ error: "Both tasks must be in this plan." }, { status: 400 });
  }

  const dep = await createDependency({
    projectId: id,
    predecessorId,
    successorId,
    type: body.type ?? "FS",
    lag: Number(body.lag ?? 0),
  });

  // Reject the link if it just created a loop, rather than leaving the plan broken.
  const project = await getProject(id);
  if (project) {
    const check = scheduleProject(project, await listTasks(id), await listDependencies(id));
    if (check.errors.some((e) => e.startsWith("Circular"))) {
      if (dep) {
        const { deleteDependency } = await import("@/lib/db");
        await deleteDependency(dep.id);
      }
      return NextResponse.json(
        { error: "That link would create a circular dependency, so it was not added." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ dependency: dep, bundle: await loadProject(id) }, { status: 201 });
}
