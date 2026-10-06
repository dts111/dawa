import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access";
import { deleteUserAndPlans, getUserById, listUsersWithStats, setUserStatus } from "@/lib/db";
import { issueAccountLink } from "@/lib/accountLinks";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * { action: "resend" }  — new invite link (account not yet set up)
 * { action: "reset" }   — password-reset link; signs the user out everywhere
 * { action: "disable" | "enable" }
 */
export async function POST(req: Request, { params }: Ctx) {
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  const { id } = await params;
  const target = await getUserById(id);
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  // The admin account is managed through ADMIN_EMAIL / ADMIN_PASSWORD, not from here.
  if (target.role === "admin") {
    return NextResponse.json({ error: "The administrator account can't be changed here." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "resend":
    case "reset": {
      if (target.status === "disabled") {
        return NextResponse.json({ error: "Enable the account first." }, { status: 400 });
      }
      const kind = body.action === "resend" || target.status === "invited" ? "invite" : "reset";
      const result = await issueAccountLink(target, kind, access.user.email);
      return NextResponse.json({ ...result, users: await listUsersWithStats() });
    }
    case "disable":
      await setUserStatus(id, "disabled");
      break;
    case "enable":
      // Back to "invited" if they never set a password, so their next link still works.
      await setUserStatus(id, target.lastLoginAt ? "active" : "invited");
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, users: await listUsersWithStats() });
}

/** Deletes the user and all of their plans. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  const { id } = await params;
  const target = await getUserById(id);
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (target.role === "admin") {
    return NextResponse.json({ error: "The administrator account can't be deleted." }, { status: 400 });
  }
  await deleteUserAndPlans(id);
  return NextResponse.json({ ok: true, users: await listUsersWithStats() });
}
