import { NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const bundle = loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json(bundle);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const project = updateProject(id, body);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
