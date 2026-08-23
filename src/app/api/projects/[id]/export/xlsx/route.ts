import { NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/excel";
import { loadProject } from "@/lib/projectData";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const bundle = loadProject(id);
  if (!bundle) return NextResponse.json({ error: "Project not found." }, { status: 404 });

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
