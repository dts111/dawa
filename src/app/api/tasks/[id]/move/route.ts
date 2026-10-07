import { NextResponse } from "next/server";
import { requireProjectOf } from "@/lib/access";
import { getTask, logActivity, moveTask, type MoveRequest } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Reorders a task in one step:
 *   { direction: "up" | "down" }                       — the Move up / Move down buttons
 *   { targetId, position: "before" | "after" }         — dragging by the # number
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProjectOf("task", id);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  let move: MoveRequest;
  if (body.direction === "up" || body.direction === "down") {
    move = { direction: body.direction };
  } else if (typeof body.targetId === "string" && (body.position === "before" || body.position === "after")) {
    move = { targetId: body.targetId, position: body.position };
  } else {
    return NextResponse.json({ error: "Say which way to move the task." }, { status: 400 });
  }

  const result = await moveTask(id, move);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if ("targetId" in move) {
    const task = await getTask(id);
    if (task) await logActivity({ projectId: result.projectId, taskId: id, actor: "app", message: `Task "${task.name}" moved` });
  }
  return NextResponse.json({ bundle: await loadProject(result.projectId) });
}
