import { NextResponse } from "next/server";
import { deleteAutomation, getAutomation, updateAutomation } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { runRule } from "@/lib/automations";
import { requireProjectOf } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProjectOf("automation", id);
  if (!access.ok) return access.response;
  const existing = await getAutomation(id);
  if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const rule = await updateAutomation(id, body);
  return NextResponse.json({ rule, bundle: await loadProject(existing.projectId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProjectOf("automation", id);
  if (!access.ok) return access.response;
  const existing = await getAutomation(id);
  if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  await deleteAutomation(id);
  return NextResponse.json({ ok: true, bundle: await loadProject(existing.projectId) });
}

/** Run a single rule now — `?dryRun=1` reports what it would do without sending. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProjectOf("automation", id);
  if (!access.ok) return access.response;
  const rule = await getAutomation(id);
  if (!rule) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  const bundle = await loadProject(rule.projectId);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const outcome = await runRule(rule, bundle, { dryRun });
  return NextResponse.json({ outcome, dryRun, bundle: await loadProject(rule.projectId) });
}
