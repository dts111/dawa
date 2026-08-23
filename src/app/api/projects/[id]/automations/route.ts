import { NextResponse } from "next/server";
import { createAutomation, listAutomations } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import type { AutomationAction, AutomationTrigger, TaskStatus } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const TRIGGERS: AutomationTrigger[] = [
  "due_in_days",
  "overdue",
  "starting_in_days",
  "not_started_but_should_be",
  "status_is",
];
const ACTIONS: AutomationAction[] = ["email_owner", "email_addresses"];

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ automations: listAutomations(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const trigger = TRIGGERS.includes(body.trigger) ? (body.trigger as AutomationTrigger) : null;
  const action = ACTIONS.includes(body.action) ? (body.action as AutomationAction) : null;
  if (!trigger || !action) {
    return NextResponse.json({ error: "Pick a trigger and an action." }, { status: 400 });
  }
  if (action === "email_addresses" && !String(body.actionEmails ?? "").trim()) {
    return NextResponse.json({ error: "Add at least one email address." }, { status: 400 });
  }

  const rule = createAutomation({
    projectId: id,
    name: String(body.name ?? "").trim() || "Untitled rule",
    trigger,
    triggerDays: Math.max(0, Math.min(365, Math.round(Number(body.triggerDays ?? 3)))),
    triggerStatus: (body.triggerStatus as TaskStatus) ?? null,
    action,
    actionEmails: body.actionEmails ?? null,
    includeButtons: body.includeButtons === false ? 0 : 1,
    enabled: body.enabled === false ? 0 : 1,
  });

  return NextResponse.json({ rule, bundle: loadProject(id) }, { status: 201 });
}
