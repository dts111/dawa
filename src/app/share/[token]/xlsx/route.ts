import { NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/excel";
import { getActiveShareLink } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/** Excel download for read-only viewers, authorised by their share token. */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const link = await getActiveShareLink(token);
  const bundle = link ? await loadProject(link.projectId) : null;
  if (!bundle) return NextResponse.json({ error: "This link is no longer active." }, { status: 404 });

  const buffer = await buildWorkbook(bundle);
  const safeName = bundle.project.name.replace(/[^a-z0-9\- ]/gi, "").trim() || "project";
  const filename = `${safeName} - Schedule ${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
