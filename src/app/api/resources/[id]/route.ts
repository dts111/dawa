import { NextResponse } from "next/server";
import { deleteResource, getDb, updateResource } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import type { Resource } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function find(id: string): Resource | undefined {
  return getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as Resource | undefined;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = find(id);
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const resource = updateResource(id, body);
  return NextResponse.json({ resource, bundle: loadProject(existing.projectId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = find(id);
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  deleteResource(id);
  return NextResponse.json({ ok: true, bundle: loadProject(existing.projectId) });
}
