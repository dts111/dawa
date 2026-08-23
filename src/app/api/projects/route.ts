import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { todayISO } from "@/lib/calendar";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  const project = createProject({
    name,
    description: body.description ?? null,
    startDate: body.startDate ?? todayISO(),
    holidays: body.holidays ?? [],
    workingDays: body.workingDays ?? [1, 2, 3, 4, 5],
  });
  return NextResponse.json({ project }, { status: 201 });
}
