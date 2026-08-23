import { NextResponse } from "next/server";
import { createDependency, listDependencies } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { scheduleProject } from "@/lib/schedule";
import { listTasks, getProject } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ dependencies: listDependencies(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const predecessorId = String(body.predecessorId ?? "");
  const successorId = String(body.successorId ?? "");
  if (!predecessorId || !successorId || predecessorId === successorId) {
    return NextResponse.json({ error: "Pick two different tasks to link." }, { status: 400 });
  }

  const dep = createDependency({
    projectId: id,
    predecessorId,
    successorId,
    type: body.type ?? "FS",
    lag: Number(body.lag ?? 0),
  });

  // Reject the link if it just created a loop, rather than leaving the plan broken.
  const project = getProject(id);
  if (project) {
    const check = scheduleProject(project, listTasks(id), listDependencies(id));
    if (check.errors.some((e) => e.startsWith("Circular"))) {
      if (dep) {
        const { deleteDependency } = await import("@/lib/db");
        deleteDependency(dep.id);
      }
      return NextResponse.json(
        { error: "That link would create a circular dependency, so it was not added." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ dependency: dep, bundle: loadProject(id) }, { status: 201 });
}
