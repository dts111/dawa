import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth";

// Everything requires a signed-in admin session, except:
//  - /login and the auth API, so you can actually sign in
//  - /r/[token] and /api/respond — the emailed one-click links are secured by
//    their own signed one-time token and are meant to work with no login at all
//  - /share/[token] — read-only plan links for stakeholders, secured by their
//    unguessable, revocable token
//  - /api/automations/run — called by an external scheduler; the route itself
//    requires AUTOMATION_SECRET (or a signed-in session)
//  - the tab icon and logo image, which the sign-in page itself shows
export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.png|dafegen-mark.png|login|api/auth/|r/|api/respond|share/|api/automations/run).*)"],
};

export function proxy(request: NextRequest) {
  const session = verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}
