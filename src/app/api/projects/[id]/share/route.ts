import { NextResponse } from "next/server";
import { createShareLink, getActiveShareLink, logActivity, revokeShareLink } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { requireProject } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const body = await req.json().catch(() => ({}));
  const link = await createShareLink(id, body.label ?? null);
  await logActivity({ projectId: id, actor: "app", message: "Read-only share link created" });
  return NextResponse.json({ link, bundle: await loadProject(id) }, { status: 201 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "No link specified." }, { status: 400 });
  const link = await getActiveShareLink(token);
  if (!link || link.projectId !== id) return NextResponse.json({ error: "Link not found." }, { status: 404 });
  await revokeShareLink(token);
  await logActivity({ projectId: id, actor: "app", message: "Read-only share link revoked" });
  return NextResponse.json({ ok: true, bundle: await loadProject(id) });
}
