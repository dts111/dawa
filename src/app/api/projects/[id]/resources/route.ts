import { NextResponse } from "next/server";
import { createResource, listResources } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ resources: listResources(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  const resource = createResource({
    projectId: id,
    name,
    email: body.email ?? null,
    role: body.role ?? null,
    dayRate: Number(body.dayRate ?? 0),
  });
  return NextResponse.json({ resource, bundle: loadProject(id) }, { status: 201 });
}
