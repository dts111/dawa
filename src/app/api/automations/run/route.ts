import { NextResponse } from "next/server";
import { runAllRules } from "@/lib/automations";

export const runtime = "nodejs";

/**
 * Runs every enabled rule across every project. Point a scheduler at this once
 * a working morning — Windows Task Scheduler, cron, or your host's scheduler:
 *
 *   curl -X POST -H "x-automation-secret: <secret>" https://your-app/api/automations/run
 *
 * Set AUTOMATION_SECRET in .env.local to require the header. If it is unset the
 * endpoint is open, which is fine on a machine only your team can reach but
 * should be set before the app is on a public domain.
 */
async function handle(req: Request) {
  const secret = process.env.AUTOMATION_SECRET;
  if (secret) {
    const provided = req.headers.get("x-automation-secret") ?? new URL(req.url).searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
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
