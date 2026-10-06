import { NextResponse } from "next/server";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getUserAuthByInviteHash, recordLoginSuccess, setPasswordAndActivate } from "@/lib/db";
import { hashPassword, hashToken, MIN_PASSWORD_LENGTH } from "@/lib/passwords";

export const runtime = "nodejs";

/** Accepts an invite (or reset) link: sets the password, activates the account and signs in. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";

  const user = token ? await getUserAuthByInviteHash(hashToken(token)) : null;
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date().toISOString() || user.status === "disabled") {
    return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` },
      { status: 400 },
    );
  }

  const active = await setPasswordAndActivate(user.id, await hashPassword(password));
  await recordLoginSuccess(active.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(active.id, active.sessionVersion), sessionCookieOptions());
  return res;
}
