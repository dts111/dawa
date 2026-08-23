import { NextResponse } from "next/server";
import { deleteDependency, getDb } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import type { Dependency } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const dep = getDb().prepare("SELECT * FROM dependencies WHERE id = ?").get(id) as Dependency | undefined;
  if (!dep) return NextResponse.json({ error: "Link not found." }, { status: 404 });
  deleteDependency(id);
  return NextResponse.json({ ok: true, bundle: loadProject(dep.projectId) });
}
