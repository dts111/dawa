import { NextResponse } from "next/server";
import { checkCredentials, createSessionValue, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!checkCredentials(email, password)) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(email.trim().toLowerCase()), {
    httpOnly: true,
    // APP_URL, not NODE_ENV — `next start` sets NODE_ENV=production even for
    // plain-HTTP LAN/localhost use, and a Secure cookie would silently stop
    // being sent by the browser in that case.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
