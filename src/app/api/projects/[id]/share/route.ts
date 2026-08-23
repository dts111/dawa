import { NextResponse } from "next/server";
import { createShareLink, logActivity, revokeShareLink } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const link = createShareLink(id, body.label ?? null);
  logActivity({ projectId: id, actor: "app", message: "Read-only share link created" });
  return NextResponse.json({ link, bundle: loadProject(id) }, { status: 201 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "No link specified." }, { status: 400 });
  revokeShareLink(token);
  logActivity({ projectId: id, actor: "app", message: "Read-only share link revoked" });
  return NextResponse.json({ ok: true, bundle: loadProject(id) });
}
