import { NextResponse } from "next/server";
import { deleteDependency, getDependency } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const dep = await getDependency(id);
  if (!dep) return NextResponse.json({ error: "Link not found." }, { status: 404 });
  await deleteDependency(id);
  return NextResponse.json({ ok: true, bundle: await loadProject(dep.projectId) });
}
