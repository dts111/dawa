import { NextResponse } from "next/server";
import { createInvite, getActiveShareLink, logActivity, markInviteSent } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { renderShareInvite, sendEmail, type SendResult } from "@/lib/email";
import { requireProject } from "@/lib/access";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_INVITES = 50;

/**
 * Emails stakeholders their own read-only link to the plan.
 *   { emails: string[], message?: string }  — invite (or re-invite) people
 *   { resendToken: string }                  — send one existing invite again
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireProject(id);
  if (!access.ok) return access.response;
  const bundle = await loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { user } = access;
  const from = user.name && user.name !== "Administrator" ? `${user.name} (${user.email})` : user.email;

  let targets: { email: string; message: string | null; token: string }[] = [];

  if (typeof body.resendToken === "string") {
    const link = await getActiveShareLink(body.resendToken);
    if (!link || link.projectId !== id || !link.email) {
      return NextResponse.json({ error: "That invite no longer exists." }, { status: 404 });
    }
    targets = [{ email: link.email, message: link.message, token: link.token }];
  } else {
    const raw: string[] = Array.isArray(body.emails) ? body.emails.map(String) : [];
    const emails = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (!emails.length) return NextResponse.json({ error: "Add at least one email address." }, { status: 400 });
    if (invalid.length) {
      return NextResponse.json({ error: `Not a valid email address: ${invalid.join(", ")}` }, { status: 400 });
    }
    if (emails.length > MAX_INVITES) {
      return NextResponse.json({ error: `Invite at most ${MAX_INVITES} people at a time.` }, { status: 400 });
    }
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 2000) : null;
    for (const email of emails) {
      const link = await createInvite(id, email, message);
      targets.push({ email, message, token: link.token });
    }
  }

  const results: SendResult[] = [];
  let previewHtml: string | null = null;
  for (const t of targets) {
    const { subject, html } = renderShareInvite(bundle, t.token, t.message, from);
    const res = await sendEmail(t.email, subject, html);
    if (res.sent) await markInviteSent(t.token);
    previewHtml ??= res.previewHtml ?? null;
    results.push({ to: res.to, sent: res.sent, error: res.error });
  }

  const sent = results.filter((r) => r.sent).length;
  await logActivity({
    projectId: id,
    actor: from,
    message: `Shared the plan (view only) with ${targets.map((t) => t.email).join(", ")}${
      sent < targets.length ? ` — ${targets.length - sent} not emailed` : ""
    }`,
  });

  return NextResponse.json({ results, sent, previewHtml, bundle: await loadProject(id) });
}
