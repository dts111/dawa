import { NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import {
  isEmailConfigured,
  renderProjectDigest,
  renderTaskUpdateRequest,
  sendEmail,
  type SendResult,
} from "@/lib/email";
import { todayISO } from "@/lib/calendar";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const bundle = loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const type: "digest" | "task_updates" = body.type === "digest" ? "digest" : "task_updates";
  const preview: boolean = Boolean(body.preview);
  const today = todayISO();
  const results: SendResult[] = [];

  if (type === "digest") {
    const { subject, html } = renderProjectDigest(bundle, today);
    const recipients: string[] = Array.isArray(body.recipients) && body.recipients.length
      ? body.recipients.map(String)
      : bundle.resources.map((r) => r.email).filter((e): e is string => Boolean(e));

    if (preview) return NextResponse.json({ preview: true, subject, html, recipients });
    if (!recipients.length) {
      return NextResponse.json(
        { error: "No email addresses found. Add email addresses to your team members first." },
        { status: 400 },
      );
    }
    for (const to of recipients) results.push(await sendEmail(to, subject, html));
  } else {
    // One personalised email per person, covering only their unfinished tasks.
    const byResource = new Map<string, { name: string; email: string; taskIds: Set<string> }>();
    for (const r of bundle.resources) {
      if (r.email) byResource.set(r.id, { name: r.name, email: r.email, taskIds: new Set() });
    }
    for (const a of bundle.assignments) {
      byResource.get(a.resourceId)?.taskIds.add(a.taskId);
    }

    const targets = [...byResource.entries()].filter(
      ([, v]) => v.taskIds.size > 0 && (!body.recipients?.length || body.recipients.includes(v.email)),
    );
    if (!targets.length) {
      return NextResponse.json(
        { error: "Nobody to email — assign tasks to team members who have an email address." },
        { status: 400 },
      );
    }

    for (const [, person] of targets) {
      const tasks = bundle.schedule.tasks.filter(
        (t) => person.taskIds.has(t.id) && !t.isSummary && t.rolledPercentComplete < 100,
      );
      if (!tasks.length) continue;
      const { subject, html } = renderTaskUpdateRequest(bundle, person.name, person.email, tasks, today);
      if (preview) return NextResponse.json({ preview: true, subject, html, recipients: [person.email] });
      results.push(await sendEmail(person.email, subject, html));
    }
  }

  const sent = results.filter((r) => r.sent).length;
  logActivity({
    projectId: id,
    actor: "app",
    message: `${type === "digest" ? "Status digest" : "Task update request"} sent to ${sent} recipient(s)`,
  });

  return NextResponse.json({
    configured: isEmailConfigured(),
    sent,
    attempted: results.length,
    results: results.map(({ previewHtml, ...r }) => {
      void previewHtml;
      return r;
    }),
  });
}
