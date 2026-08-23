import { NextResponse } from "next/server";
import { clearBaseline, logActivity, saveBaseline } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Freeze today's computed schedule as the baseline to measure slippage against. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const bundle = loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  saveBaseline(
    id,
    bundle.schedule.tasks.map((t) => ({
      id: t.id,
      start: t.start,
      finish: t.finish,
      duration: t.duration,
    })),
  );
  logActivity({ projectId: id, actor: "app", message: "Baseline saved" });
  return NextResponse.json({ ok: true, bundle: loadProject(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  clearBaseline(id);
  logActivity({ projectId: id, actor: "app", message: "Baseline cleared" });
  return NextResponse.json({ ok: true, bundle: loadProject(id) });
}
