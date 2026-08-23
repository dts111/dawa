import { NextResponse } from "next/server";
import { applyResponse } from "@/lib/respond";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const choice = String(form?.get("choice") ?? "");
  const days = Number(form?.get("days") ?? 0);
  const result = applyResponse(token, choice, days);
  const url = new URL(`/r/${token}`, req.url);
  url.searchParams.set("done", result.ok ? "1" : "0");
  url.searchParams.set("msg", result.message);
  return NextResponse.redirect(url, { status: 303 });
}
