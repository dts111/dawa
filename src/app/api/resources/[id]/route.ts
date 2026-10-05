import { NextResponse } from "next/server";
import { deleteResource, getResource, updateResource } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = await getResource(id);
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const resource = await updateResource(id, body);
  return NextResponse.json({ resource, bundle: await loadProject(existing.projectId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = await getResource(id);
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  await deleteResource(id);
  return NextResponse.json({ ok: true, bundle: await loadProject(existing.projectId) });
}
