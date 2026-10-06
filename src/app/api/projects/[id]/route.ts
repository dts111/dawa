import { NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { requireProject } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const bundle = await loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json(bundle);
}

const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO_CHARS = 300_000;

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const body = await req.json().catch(() => ({}));

  // Client branding: validate here, since these values are shown to stakeholders.
  if ("clientName" in body) {
    const name = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 80) : "";
    body.clientName = name || null;
  }
  if ("clientLogo" in body && body.clientLogo !== null) {
    if (typeof body.clientLogo !== "string" || body.clientLogo.length > MAX_LOGO_CHARS || !LOGO_PATTERN.test(body.clientLogo)) {
      return NextResponse.json({ error: "Logo must be a PNG, JPEG or WebP image under 200 KB." }, { status: 400 });
    }
  }

  const project = await updateProject(id, body);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
