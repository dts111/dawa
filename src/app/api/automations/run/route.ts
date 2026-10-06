import { NextResponse } from "next/server";
import { runAllRules } from "@/lib/automations";
import { currentUser } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Runs every enabled rule across every project. Point a scheduler at this once
 * a working morning — the included GitHub Actions workflow, cron, Windows Task
 * Scheduler or your host's scheduler:
 *
 *   curl -X POST -H "x-automation-secret: <secret>" https://your-app/api/automations/run
 *
 * The endpoint sits outside the sign-in gate so schedulers can reach it, so it
 * authorises itself: the AUTOMATION_SECRET header (or ?secret=), or a signed-in
 * admin session. With no secret configured, only a signed-in admin can run it.
 */
async function handle(req: Request) {
  const secret = process.env.AUTOMATION_SECRET;
  const provided = req.headers.get("x-automation-secret") ?? new URL(req.url).searchParams.get("secret");
  // Runs every user's rules, so a session only counts if it's the admin's.
  const signedInAdmin = (await currentUser())?.role === "admin";
  if (!signedInAdmin && !(secret && provided === secret)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const results = await runAllRules();
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    rules: results.length,
    totalSent: results.reduce((a, r) => a + r.sent, 0),
    results,
  });
}

export async function POST(req: Request) {
  return handle(req);
}

// GET is allowed too, so schedulers that can only fetch a URL still work.
export async function GET(req: Request) {
  return handle(req);
}
