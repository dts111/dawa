import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access";
import { createInvitedUser, getUserAuthByEmail, listUsersWithStats } from "@/lib/db";
import { issueAccountLink } from "@/lib/accountLinks";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export async function GET() {
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  return NextResponse.json({ users: await listUsersWithStats() });
}

/** Invite a new user: { email, name }. Returns the invite link too, for passing on by hand. */
export async function POST(req: Request) {
  const access = await requireAdmin();
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });
  if (await getUserAuthByEmail(email)) {
    return NextResponse.json({ error: "Someone with that email already has an account." }, { status: 409 });
  }

  const user = await createInvitedUser({ email, name });
  const result = await issueAccountLink(user, "invite", access.user.email);
  return NextResponse.json({ user, ...result, users: await listUsersWithStats() }, { status: 201 });
}
