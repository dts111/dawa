import { NextResponse } from "next/server";
import { deleteProject, listTasks, updateProject } from "@/lib/db";
import { TABLE_COLUMNS, type TableColumn, type TableLayout } from "@/lib/types";
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

const clamp = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : null;

/**
 * Keeps only known columns and this plan's tasks, with sizes clamped to sensible
 * ranges. Returns null when the shape is wrong.
 */
async function cleanTableLayout(raw: unknown, projectId: string): Promise<TableLayout | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { cols, rows } = raw as { cols?: unknown; rows?: unknown };
  const out: TableLayout = {};

  if (cols !== undefined) {
    if (!cols || typeof cols !== "object" || Array.isArray(cols)) return null;
    const clean: Partial<Record<TableColumn, number>> = {};
    for (const key of TABLE_COLUMNS) {
      const w = clamp((cols as Record<string, unknown>)[key], 60, 800);
      if (w !== null) clean[key] = w;
    }
    out.cols = clean;
  }

  if (rows !== undefined) {
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) return null;
    const entries = Object.entries(rows as Record<string, unknown>);
    if (entries.length > 2000) return null;
    const taskIds = new Set((await listTasks(projectId)).map((t) => t.id));
    const clean: Record<string, number> = {};
    for (const [taskId, h] of entries) {
      const height = clamp(h, 32, 600);
      if (height !== null && taskIds.has(taskId)) clean[taskId] = height;
    }
    out.rows = clean;
  }
  return out;
}

const LOGO_PATTERN =/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
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

  if ("tableLayout" in body && body.tableLayout !== null) {
    const layout = await cleanTableLayout(body.tableLayout, id);
    if (!layout) return NextResponse.json({ error: "Invalid table layout." }, { status: 400 });
    body.tableLayout = layout;
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
