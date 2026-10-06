import { NextResponse } from "next/server";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getUserAuthByEmail, recordLoginFailure, recordLoginSuccess } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";

export const runtime = "nodejs";

// One message for every failure, so the form doesn't reveal which emails have accounts.
const FAILED = "Incorrect email or password.";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: FAILED }, { status: 401 });

  const user = await getUserAuthByEmail(email);
  if (!user) {
    // Spend the same time as a real check, so response timing doesn't reveal unknown emails.
    await verifyPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
    return NextResponse.json({ error: FAILED }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date().toISOString()) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || user.status !== "active") {
    if (!ok) await recordLoginFailure(user);
    return NextResponse.json({ error: FAILED }, { status: 401 });
  }

  await recordLoginSuccess(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(user.id, Number(user.sessionVersion)), sessionCookieOptions());
  return res;
}
